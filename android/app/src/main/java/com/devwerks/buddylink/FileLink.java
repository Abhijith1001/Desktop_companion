package com.devwerks.buddylink;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// File transfer over the Bluetooth link, both ways. Messages (one JSON line each):
//   fs {id,name,size,mime}  start      fc {id,d}  chunk (base64)   fe {id}  end
//   fa {id,n}  receiver has n bytes    fd {id}    saved            fx {id,reason}  cancelled/failed
// The sender keeps at most WINDOW bytes unconfirmed, so notifications still
// get through during a transfer and a cancel stops it quickly.
public final class FileLink {
    interface Out {
        boolean send(String line);
    }

    static final int CHUNK = 24 * 1024;
    private static final long WINDOW = 384 * 1024;
    private static final long ACK_EVERY = 128 * 1024;
    private static final String CHANNEL = "transfers";
    private static final String FOLDER = "Desktop Buddy";

    private final Context ctx;
    private final Out out;
    private final Map<String, Incoming> incoming = new ConcurrentHashMap<>();
    private final Map<String, Outgoing> outgoing = new ConcurrentHashMap<>();
    private final ExecutorService sender = Executors.newSingleThreadExecutor();

    FileLink(Context ctx, Out out) {
        this.ctx = ctx.getApplicationContext();
        this.out = out;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "File transfers", NotificationManager.IMPORTANCE_LOW));
    }

    // ---------------------------------------------------------------- incoming (PC → phone)

    private static final class Incoming {
        String id, name, mime;
        long size, received, lastAck;
        int lastPct = -1;
        OutputStream stream;
        Uri uri;      // Android 10+: MediaStore Downloads entry
        File file;    // older phones: app's own Downloads folder
    }

    boolean handle(JSONObject m) {
        String t = m.optString("t");
        String id = m.optString("id");
        switch (t) {
            case "fs": startIncoming(id, m.optString("name"), m.optLong("size"), m.optString("mime")); return true;
            case "fc": chunk(id, m.optString("d")); return true;
            case "fe": finishIncoming(id); return true;
            case "fa": {
                Outgoing o = outgoing.get(id);
                if (o != null) synchronized (o) { o.acked = Math.max(o.acked, m.optLong("n")); o.notifyAll(); }
                return true;
            }
            case "fd": {
                Outgoing o = outgoing.get(id);
                if (o != null) synchronized (o) { o.saved = true; o.notifyAll(); }
                return true;
            }
            case "fx": {
                String why = m.optString("reason", "Cancelled");
                Outgoing o = outgoing.get(id);
                if (o != null) synchronized (o) { o.cancelled = why; o.notifyAll(); }
                Incoming in = incoming.remove(id);
                if (in != null) dropIncoming(in, why);
                return true;
            }
            default:
                return false;
        }
    }

    private void startIncoming(String id, String rawName, long size, String mime) {
        if (id.isEmpty()) return;
        Incoming in = new Incoming();
        in.id = id;
        in.name = safeName(rawName);
        in.size = Math.max(0, size);
        in.mime = !mime.isEmpty() ? mime : guessMime(in.name);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, in.name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, in.mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                in.uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (in.uri == null) throw new IOException("Couldn't create the file");
                in.stream = ctx.getContentResolver().openOutputStream(in.uri);
            } else {
                File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Couldn't create the folder");
                in.file = unique(dir, in.name);
                in.stream = new FileOutputStream(in.file);
            }
            if (in.stream == null) throw new IOException("Couldn't open the file");
        } catch (IOException | RuntimeException e) {
            cleanup(in);
            send(msg("fx", id).put2("reason", "Phone couldn't save the file"));
            return;
        }
        incoming.put(id, in);
        progress(in.id, "Receiving " + in.name, 0, in.size, false);
    }

    private void chunk(String id, String b64) {
        Incoming in = incoming.get(id);
        if (in == null) return;
        try {
            byte[] data = Base64.decode(b64, Base64.NO_WRAP);
            in.stream.write(data);
            in.received += data.length;
            if (in.received - in.lastAck >= ACK_EVERY) {
                in.lastAck = in.received;
                send(msg("fa", id).put2("n", in.received));
            }
            int pct = in.size > 0 ? (int) (in.received * 100 / in.size) : 0;
            if (pct != in.lastPct && pct % 5 == 0) {
                in.lastPct = pct;
                progress(in.id, "Receiving " + in.name, in.received, in.size, false);
            }
        } catch (IOException | IllegalArgumentException e) {
            incoming.remove(id);
            dropIncoming(in, "Phone couldn't save the file");
            send(msg("fx", id).put2("reason", "Phone couldn't save the file"));
        }
    }

    private void finishIncoming(String id) {
        Incoming in = incoming.remove(id);
        if (in == null) return;
        try {
            in.stream.close();
            in.stream = null;
            if (in.uri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                ctx.getContentResolver().update(in.uri, v, null, null);
            }
        } catch (IOException | RuntimeException e) {
            dropIncoming(in, "Phone couldn't save the file");
            send(msg("fx", id).put2("reason", "Phone couldn't save the file"));
            return;
        }
        send(msg("fa", id).put2("n", in.received));
        send(msg("fd", id));
        Uri open = in.uri;
        if (open == null && in.file != null) open = Uri.fromFile(in.file);
        done(id, "Received from your PC", in.name + " · Downloads/" + FOLDER, open, in.mime);
    }

    private void dropIncoming(Incoming in, String why) {
        cleanup(in);
        done(in.id, "Transfer stopped", in.name + " · " + why, null, null);
    }

    private void cleanup(Incoming in) {
        try { if (in.stream != null) in.stream.close(); } catch (IOException ignored) { }
        in.stream = null;
        try { if (in.uri != null) ctx.getContentResolver().delete(in.uri, null, null); } catch (RuntimeException ignored) { }
        if (in.file != null) //noinspection ResultOfMethodCallIgnored
            in.file.delete();
    }

    // ---------------------------------------------------------------- outgoing (phone → PC)

    private static final class Outgoing {
        String id, name;
        long size, sent, acked;
        boolean saved;
        String cancelled;
    }

    // Files from the share sheet. The descriptors are opened by the share screen
    // while it still has permission to read them.
    void sendFiles(final java.util.List<Shared> files) {
        for (final Shared f : files) sender.execute(() -> sendOne(f));
    }

    static final class Shared {
        final ParcelFileDescriptor fd;
        final String name, mime;
        final long size;

        Shared(ParcelFileDescriptor fd, String name, String mime, long size) {
            this.fd = fd; this.name = name; this.mime = mime; this.size = size;
        }
    }

    private void sendOne(Shared f) {
        Outgoing o = new Outgoing();
        o.id = UUID.randomUUID().toString().substring(0, 12);
        o.name = safeName(f.name);
        o.size = f.size;
        outgoing.put(o.id, o);
        String error = null;
        try (InputStream in = new FileInputStream(f.fd.getFileDescriptor())) {
            if (!send(msg("fs", o.id).put2("name", o.name).put2("size", f.size).put2("mime", f.mime == null ? "" : f.mime))) throw new IOException("Not connected");
            byte[] buf = new byte[CHUNK];
            int lastPct = -1;
            int n;
            while ((n = in.read(buf)) > 0) {
                synchronized (o) {
                    while (o.cancelled == null && o.sent - o.acked > WINDOW && LinkServer.isConnected()) o.wait(500);
                    if (o.cancelled != null) throw new IOException(o.cancelled);
                }
                if (!LinkServer.isConnected()) throw new IOException("The PC disconnected");
                if (!send(msg("fc", o.id).put2("d", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)))) throw new IOException("The PC disconnected");
                o.sent += n;
                int pct = o.size > 0 ? (int) (o.sent * 100 / o.size) : 0;
                if (pct != lastPct && pct % 5 == 0) {
                    lastPct = pct;
                    progress(o.id, "Sending " + o.name, o.sent, o.size, true);
                }
            }
            send(msg("fe", o.id));
            long deadline = System.currentTimeMillis() + 60_000;
            synchronized (o) {
                while (!o.saved && o.cancelled == null && System.currentTimeMillis() < deadline && LinkServer.isConnected()) o.wait(500);
                if (o.cancelled != null) throw new IOException(o.cancelled);
                if (!o.saved) throw new IOException("The PC didn't confirm the file");
            }
        } catch (IOException e) {
            error = e.getMessage() != null ? e.getMessage() : "Failed";
            send(msg("fx", o.id).put2("reason", error));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            error = "Stopped";
        } finally {
            outgoing.remove(o.id);
            try { f.fd.close(); } catch (IOException ignored) { }
        }
        if (error == null) done(o.id, "Sent to your PC", o.name + " · saved in Downloads", null, null);
        else done(o.id, "Couldn't send " + o.name, error, null, null);
    }

    // Cancel from the phone's notification.
    void cancel(String id) {
        Outgoing o = outgoing.get(id);
        if (o != null) synchronized (o) { o.cancelled = "Cancelled on the phone"; o.notifyAll(); }
        Incoming in = incoming.remove(id);
        if (in != null) {
            send(msg("fx", id).put2("reason", "Cancelled on the phone"));
            dropIncoming(in, "Cancelled");
        }
    }

    // The link dropped: nothing in flight can finish.
    void disconnected() {
        for (Incoming in : incoming.values()) dropIncoming(in, "The PC disconnected");
        incoming.clear();
        for (Outgoing o : outgoing.values()) synchronized (o) { o.notifyAll(); }
    }

    void shutdown() {
        disconnected();
        for (Outgoing o : outgoing.values()) synchronized (o) { o.cancelled = "Stopped"; o.notifyAll(); }
        sender.shutdownNow();
    }

    // ---------------------------------------------------------------- helpers

    private boolean send(Msg m) {
        return out.send(m.toString());
    }

    private static Msg msg(String t, String id) {
        Msg m = new Msg();
        m.put2("t", t).put2("id", id);
        return m;
    }

    private static final class Msg extends JSONObject {
        Msg put2(String k, Object v) {
            try { put(k, v); } catch (JSONException ignored) { }
            return this;
        }
    }

    // Opens a picked or shared file while we still have permission to read it;
    // the open descriptor keeps working after that permission ends.
    static Shared open(Context ctx, Uri uri) {
        android.content.ContentResolver cr = ctx.getContentResolver();
        try {
            ParcelFileDescriptor fd = cr.openFileDescriptor(uri, "r");
            if (fd == null) return null;
            String name = null;
            long size = fd.getStatSize();
            try (android.database.Cursor c = cr.query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE}, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int n = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                    int s = c.getColumnIndex(android.provider.OpenableColumns.SIZE);
                    if (n >= 0) name = c.getString(n);
                    if (size <= 0 && s >= 0 && !c.isNull(s)) size = c.getLong(s);
                }
            } catch (RuntimeException ignored) {
            }
            if (name == null) name = uri.getLastPathSegment();
            return new Shared(fd, safeName(name), cr.getType(uri), Math.max(size, 0));
        } catch (Exception e) {
            return null;
        }
    }

    // Sends picked files from the app's own screen. Returns how many were queued.
    public static int sendUris(Context ctx, java.util.List<Uri> uris) {
        LinkServer s = LinkServer.current;
        if (s == null || !LinkServer.isConnected()) return -1;
        java.util.List<Shared> files = new java.util.ArrayList<>();
        for (Uri u : uris) {
            Shared f = open(ctx, u);
            if (f != null) files.add(f);
        }
        if (!files.isEmpty()) s.files.sendFiles(files);
        return files.size();
    }

    static String safeName(String raw) {
        String s = raw == null ? "" : raw;
        int slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        if (slash >= 0) s = s.substring(slash + 1);
        s = s.replaceAll("[\\x00-\\x1f<>:\"|?*]", "_").trim();
        while (s.startsWith(".")) s = s.substring(1);
        if (s.isEmpty()) s = "file";
        return s.length() > 150 ? s.substring(s.length() - 150) : s;
    }

    static String guessMime(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return m != null ? m : "application/octet-stream";
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; f.exists() && i < 1000; i++) f = new File(dir, base + " (" + i + ")" + ext);
        return f;
    }

    private boolean canNotify() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void progress(String id, String title, long done, long total, boolean outgoingDir) {
        if (!canNotify()) return;
        Intent cancel = new Intent(ctx, TransferCancelReceiver.class).setAction("cancel:" + id).putExtra("id", id);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id.hashCode(), cancel, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int pct = total > 0 ? (int) Math.min(100, done * 100 / total) : 0;
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(outgoingDir ? android.R.drawable.stat_sys_upload : android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(pct + "% · " + size(done) + " of " + size(total))
                .setProgress(100, pct, total <= 0)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setColor(0xFFE5202E)
                .addAction(new Notification.Action.Builder(null, "Cancel", pi).build())
                .build();
        notify(id, n);
    }

    private void done(String id, String title, String text, Uri open, String mime) {
        if (!canNotify()) return;
        Notification.Builder b = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setColor(0xFFE5202E)
                .setAutoCancel(true);
        if (open != null) {
            Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(open, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            b.setContentIntent(PendingIntent.getActivity(ctx, id.hashCode(), view, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        notify(id, b.build());
    }

    private void notify(String id, Notification n) {
        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null) nm.notify("transfer", id.hashCode(), n);
        } catch (SecurityException ignored) {
        }
    }

    static String size(long b) {
        if (b < 1024) return b + " B";
        if (b < 1024 * 1024) return String.format(Locale.US, "%.0f KB", b / 1024.0);
        return String.format(Locale.US, "%.1f MB", b / (1024.0 * 1024));
    }

}
