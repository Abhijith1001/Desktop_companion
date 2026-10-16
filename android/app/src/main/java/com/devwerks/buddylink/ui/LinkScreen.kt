package com.devwerks.buddylink.ui

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.devwerks.buddylink.NotifyService
import com.devwerks.buddylink.R
import kotlinx.coroutines.delay

private fun hasAccess(ctx: Context): Boolean {
    val enabled = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
    val me = ComponentName(ctx, NotifyService::class.java)
    return enabled.split(":").any { ComponentName.unflattenFromString(it) == me }
}

private fun granted(ctx: Context, perm: String) = ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED

@Composable
fun LinkScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    BackHandler { onBack() }
    // Re-checked every second or so, since the user changes these in system screens.
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1200); tick++ } }
    val askBt = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { tick++ }
    val askNotif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { tick++ }

    val access = remember(tick) { hasAccess(ctx) }
    val bt = remember(tick) { Build.VERSION.SDK_INT < Build.VERSION_CODES.S || granted(ctx, Manifest.permission.BLUETOOTH_CONNECT) }
    val notif = remember(tick) { Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(ctx, Manifest.permission.POST_NOTIFICATIONS) }
    val battery = remember(tick) { ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) == true }
    val link = rememberLinkStatus()
    val connected = link.startsWith("Connected")

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = Color.White) }
        }
        Text("PC link", style = MaterialTheme.typography.headlineLarge, color = Color.White, modifier = Modifier.padding(horizontal = 20.dp))
        Text("Your phone's notifications show up on Desktop Buddy over Bluetooth. Nothing goes to the internet.",
            style = MaterialTheme.typography.bodyMedium, color = Muted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))

        Spacer(Modifier.height(10.dp))
        Box(
            Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp))
                .background(if (connected) Brush.linearGradient(listOf(Color(0xFF0F5132), Color(0xFF07150F))) else Brush.linearGradient(listOf(CardBg2, CardBg)))
        ) {
            Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                BuddyImage(if (connected) R.raw.buddy_happy else R.raw.buddy_idle, Modifier.size(84.dp))
                HSpace(12)
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Dot(if (connected) Good else Warn)
                        HSpace(8)
                        Text(if (connected) "CONNECTED" else "NOT CONNECTED", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Black, color = if (connected) Good else Warn)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(if (!access) "Needs notification access" else if (!bt) "Needs the Bluetooth permission" else link,
                        style = MaterialTheme.typography.titleMedium, color = Color.White)
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        Text("Setup", style = MaterialTheme.typography.titleLarge, color = Color.White, modifier = Modifier.padding(horizontal = 20.dp))
        Spacer(Modifier.height(8.dp))
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Step(1, "Notification access", "Lets Buddy Link read notifications to send them to your PC.", access) {
                ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
            Step(2, "Bluetooth", "Lets your PC connect to this phone.", bt) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) askBt.launch(Manifest.permission.BLUETOOTH_CONNECT)
            }
            Step(3, "Reminders", "Show task and focus-timer reminders.", notif) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            Step(4, "Run in background", "Stops the phone from pausing the link to save battery.", battery) {
                try {
                    ctx.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")))
                } catch (e: RuntimeException) {
                    ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
            Text("On your PC", style = MaterialTheme.typography.titleMedium, color = Color.White)
            Spacer(Modifier.height(4.dp))
            Text("1. Pair this phone with the PC in Windows Bluetooth settings.\n2. In Desktop Buddy, open Phone and turn on “Get notifications over Bluetooth”.\n\nIt reconnects by itself whenever you're in range.",
                style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        Spacer(Modifier.height(8.dp))
        Text("Notification access greyed out? Open Settings › Apps › Buddy Link, tap ⋮ and choose “Allow restricted settings”.",
            style = MaterialTheme.typography.bodySmall, color = Muted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Step(n: Int, title: String, text: String, done: Boolean, onClick: () -> Unit) {
    BCard(Modifier.fillMaxWidth(), onClick = if (done) null else onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).clip(CircleShape).background(if (done) Good else BoatRed), contentAlignment = Alignment.Center) {
                if (done) Icon(Icons.Rounded.Check, contentDescription = "Done", tint = Color.Black, modifier = Modifier.size(20.dp))
                else Text("$n", color = Color.White, fontWeight = FontWeight.Black)
            }
            HSpace(14)
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = Color.White)
                Text(text, style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            if (!done) Text("Allow", color = BoatRed, style = MaterialTheme.typography.labelLarge)
        }
    }
}
