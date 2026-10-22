package com.devwerks.buddylink;

import android.app.Notification;
import android.content.ComponentName;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Reads the phone's notifications (the user grants "Notification access" once)
// and hands the current list to the Bluetooth link whenever it changes.
// Nothing is stored; the list only goes to the paired computer.
public class NotifyService extends NotificationListenerService {
    private static final int MAX_TEXT = 500;

    private LinkServer server;

    @Override
    public void onListenerConnected() {
        if (server == null) {
            server = new LinkServer(this);
            server.start();
        }
    }

    @Override
    public void onListenerDisconnected() {
        if (server != null) {
            server.stop();
            server = null;
        }
        // Ask Android to bind again, so the link comes back after the system drops it.
        requestRebind(new ComponentName(this, NotifyService.class));
    }

    @Override
    public void onDestroy() {
        if (server != null) server.stop();
        server = null;
        super.onDestroy();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (server != null) server.changed();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        if (server != null) server.changed();
    }

    // Same fields the desktop's adb reader produces, so both feed one list.
    JSONArray snapshot() {
        JSONArray list = new JSONArray();
        StatusBarNotification[] active;
        try {
            active = getActiveNotifications();
        } catch (RuntimeException e) {
            return list;
        }
        if (active == null) return list;
        for (StatusBarNotification sbn : active) {
            // Our own transfer notifications aren't news for the PC.
            if (getPackageName().equals(sbn.getPackageName()) && "transfer".equals(sbn.getTag())) continue;
            try {
                list.put(toJson(sbn));
            } catch (JSONException | RuntimeException ignored) {
                // One odd notification shouldn't drop the rest.
            }
        }
        return list;
    }

    private static JSONObject toJson(StatusBarNotification sbn) throws JSONException {
        Notification n = sbn.getNotification();
        Bundle extras = n.extras;
        int flags = n.flags;
        JSONObject o = new JSONObject();
        o.put("key", sbn.getKey());
        o.put("pkg", sbn.getPackageName());
        o.put("when", n.when != 0 ? n.when : sbn.getPostTime());
        o.put("title", text(extras, Notification.EXTRA_TITLE));
        o.put("text", text(extras, Notification.EXTRA_TEXT));
        o.put("subText", text(extras, Notification.EXTRA_SUB_TEXT));
        o.put("summary", (flags & Notification.FLAG_GROUP_SUMMARY) != 0);
        o.put("ongoing", sbn.isOngoing() || (flags & Notification.FLAG_FOREGROUND_SERVICE) != 0);
        return o;
    }

    private static Object text(Bundle extras, String name) {
        if (extras == null) return JSONObject.NULL;
        CharSequence cs = extras.getCharSequence(name);
        if (cs == null) return JSONObject.NULL;
        String s = cs.toString().trim();
        if (s.isEmpty()) return JSONObject.NULL;
        return s.length() > MAX_TEXT ? s.substring(0, MAX_TEXT) : s;
    }
}
