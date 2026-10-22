package com.devwerks.buddylink;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// "Cancel" on a transfer's progress notification.
public class TransferCancelReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String id = intent.getStringExtra("id");
        LinkServer s = LinkServer.current;
        if (id != null && s != null) s.files.cancel(id);
    }
}
