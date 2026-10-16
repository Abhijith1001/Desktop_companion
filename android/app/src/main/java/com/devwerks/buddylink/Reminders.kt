package com.devwerks.buddylink

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.devwerks.buddylink.data.Store
import com.devwerks.buddylink.data.Task

// Task and focus-timer reminders, shown as phone notifications at the set time.
object Reminders {
    private const val CHANNEL = "reminders"

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
    }

    fun forTask(ctx: Context, t: Task) {
        if (t.done || t.due == null || t.due <= System.currentTimeMillis()) cancel(ctx, t.id)
        else schedule(ctx, t.id, t.title, "Task reminder from Buddy", t.due)
    }

    fun schedule(ctx: Context, id: String, title: String, text: String, at: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val pi = pending(ctx, id, title, text)
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            }
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    fun cancel(ctx: Context, id: String) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        am.cancel(pending(ctx, id, "", ""))
    }

    fun rescheduleAll(ctx: Context) {
        Store.tasks.forEach { forTask(ctx, it) }
    }

    private fun pending(ctx: Context, id: String, title: String, text: String): PendingIntent {
        val i = Intent(ctx, ReminderReceiver::class.java).setAction("remind:$id")
            .putExtra("id", id).putExtra("title", title).putExtra("text", text)
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun show(ctx: Context, id: String, title: String, text: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(text)
            .setColor(0xFFE5202E.toInt())
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            ctx.getSystemService(NotificationManager::class.java)?.notify(id.hashCode(), n)
        } catch (e: SecurityException) {
            // Notifications turned off for the app.
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        Reminders.show(ctx, id, intent.getStringExtra("title") ?: "Reminder", intent.getStringExtra("text") ?: "")
    }
}

// Alarms are cleared when the phone restarts; set them again.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        Store.init(ctx)
        Reminders.rescheduleAll(ctx)
    }
}
