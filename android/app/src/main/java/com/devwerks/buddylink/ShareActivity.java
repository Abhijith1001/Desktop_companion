package com.devwerks.buddylink;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

// "Desktop Buddy" in the phone's Share menu: sends the shared files to the PC.
// No screen of its own; it hands the files over and closes.
public class ShareActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinkServer server = LinkServer.current;
        if (server == null || !LinkServer.isConnected()) {
            Toast.makeText(this, "Your PC isn't connected. Keep Bluetooth on and Desktop Buddy running, then try again.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        List<FileLink.Shared> files = new ArrayList<>();
        for (Uri uri : uris(getIntent())) {
            FileLink.Shared f = FileLink.open(this, uri);
            if (f != null) files.add(f);
        }
        if (files.isEmpty()) {
            Toast.makeText(this, "Nothing to send", Toast.LENGTH_SHORT).show();
        } else {
            server.files.sendFiles(files);
            Toast.makeText(this, files.size() == 1 ? "Sending " + files.get(0).name + " to your PC" : "Sending " + files.size() + " files to your PC", Toast.LENGTH_SHORT).show();
        }
        finish();
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> uris(Intent i) {
        List<Uri> list = new ArrayList<>();
        if (i == null) return list;
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) list.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) {
            ArrayList<Uri> many = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) for (Uri u : many) if (u != null) list.add(u);
        }
        return list;
    }
}
