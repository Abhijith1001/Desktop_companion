package com.devwerks.buddylink;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

// Bluetooth (RFCOMM) server the computer connects to. Sends one JSON line per
// message: a hello, then the notification list on every change and every 20 s
// (the heartbeat lets the computer notice a dropped link).
public final class LinkServer {
    // Must match the desktop's bt-bridge.ps1.
    static final UUID SERVICE = UUID.fromString("6f1c2b8e-5d3a-4c7e-9a41-b2d7e0c3f915");
    private static final long HEARTBEAT_S = 20;
    private static final long DEBOUNCE_MS = 300;

    // Read by the app's screen.
    public static volatile String status = "Starting…";

    private final NotifyService service;
    private final ScheduledExecutorService sender = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean pending = new AtomicBoolean(false);
    private volatile boolean running;
    private volatile BluetoothServerSocket serverSocket;
    private volatile BluetoothSocket client;
    private volatile OutputStream out;
    private Thread acceptThread;
    private final Object writeLock = new Object();
    final FileLink files;

    // The running server, for the share screen and notification actions.
    static volatile LinkServer current;

    LinkServer(NotifyService service) {
        this.service = service;
        this.files = new FileLink(service, this::sendLine);
    }

    static boolean isConnected() {
        LinkServer s = current;
        return s != null && s.client != null;
    }

    void start() {
        running = true;
        current = this;
        acceptThread = new Thread(this::acceptLoop, "buddylink-accept");
        acceptThread.start();
        sender.scheduleWithFixedDelay(this::sendList, HEARTBEAT_S, HEARTBEAT_S, TimeUnit.SECONDS);
    }

    void stop() {
        running = false;
        closeServer();
        detach(client);
        sender.shutdownNow();
        files.shutdown();
        if (current == this) current = null;
        if (acceptThread != null) acceptThread.interrupt();
        status = "Stopped";
    }

    // Many changes in a burst (a chat app updating its group) become one send.
    void changed() {
        if (!running || client == null) return;
        if (pending.compareAndSet(false, true)) {
            sender.schedule(() -> {
                pending.set(false);
                sendList();
            }, DEBOUNCE_MS, TimeUnit.MILLISECONDS);
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                BluetoothAdapter adapter = adapter();
                if (adapter == null) {
                    status = "This phone has no Bluetooth";
                    sleep(30_000);
                    continue;
                }
                if (!hasPermission()) {
                    status = "Needs the Bluetooth permission";
                    sleep(5_000);
                    continue;
                }
                if (!adapter.isEnabled()) {
                    status = "Bluetooth is off";
                    closeServer();
                    sleep(5_000);
                    continue;
                }
                if (serverSocket == null) {
                    serverSocket = adapter.listenUsingRfcommWithServiceRecord("Desktop Buddy Link", SERVICE);
                }
                if (client == null) status = "Waiting for the computer";
                BluetoothSocket s = serverSocket.accept();
                attach(s);
            } catch (IOException | SecurityException e) {
                // Bluetooth turned off or the socket broke: start listening again.
                closeServer();
                sleep(3_000);
            }
        }
    }

    private void attach(BluetoothSocket s) {
        detach(client);
        try {
            out = s.getOutputStream();
        } catch (IOException e) {
            closeQuietly(s);
            return;
        }
        client = s;
        String name = "the computer";
        try {
            String n = s.getRemoteDevice().getName();
            if (n != null && !n.isEmpty()) name = n;
        } catch (SecurityException ignored) {
        }
        status = "Connected to " + name;
        sender.execute(() -> {
            try {
                JSONObject hello = new JSONObject();
                hello.put("t", "hello");
                hello.put("model", Build.MODEL);
                hello.put("version", 1);
                write(s, hello.toString());
            } catch (JSONException ignored) {
            }
            sendList();
        });
        // The computer sends file-transfer messages; reading also tells us when it goes away.
        Thread reader = new Thread(() -> {
            try {
                InputStream in = s.getInputStream();
                java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(in, StandardCharsets.UTF_8), 64 * 1024);
                String line;
                while ((line = r.readLine()) != null) {
                    if (!line.startsWith("{")) continue;
                    try {
                        files.handle(new JSONObject(line));
                    } catch (JSONException ignored) {
                    }
                }
            } catch (IOException ignored) {
            }
            detach(s);
        }, "buddylink-read");
        reader.start();
    }

    private void sendList() {
        BluetoothSocket s = client;
        if (s == null) return;
        try {
            JSONObject msg = new JSONObject();
            msg.put("t", "list");
            msg.put("items", service.snapshot());
            write(s, msg.toString());
        } catch (JSONException ignored) {
        }
    }

    private boolean write(BluetoothSocket s, String line) {
        synchronized (writeLock) {
            OutputStream o = out;
            if (s == null || s != client || o == null) return false;
            try {
                o.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                o.flush();
                return true;
            } catch (IOException e) {
                detach(s);
                return false;
            }
        }
    }

    // Used by file transfers (any thread); lines never interleave.
    boolean sendLine(String line) {
        return write(client, line);
    }

    private synchronized void detach(BluetoothSocket s) {
        if (s == null) return;
        closeQuietly(s);
        if (client == s) {
            client = null;
            out = null;
            files.disconnected();
            if (running) status = "Waiting for the computer";
        }
    }

    private void closeServer() {
        BluetoothServerSocket ss = serverSocket;
        serverSocket = null;
        if (ss != null) {
            try {
                ss.close();
            } catch (IOException ignored) {
            }
        }
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) service.getSystemService(Context.BLUETOOTH_SERVICE);
        return m != null ? m.getAdapter() : null;
    }

    private boolean hasPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                || service.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private static void closeQuietly(BluetoothSocket s) {
        try {
            s.close();
        } catch (IOException ignored) {
        }
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
