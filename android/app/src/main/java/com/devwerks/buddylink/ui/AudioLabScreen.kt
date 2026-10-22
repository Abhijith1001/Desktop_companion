package com.devwerks.buddylink.ui

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.media.AudioDeviceInfo
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.devwerks.buddylink.AudioRouter
import kotlinx.coroutines.delay

private data class AppItem(val label: String, val uid: Int)

/** Test bench for per-app audio routing: pick one app and one output, then apply. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AudioLabScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    BackHandler { onBack() }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1500); tick++ } }

    val running = remember(tick) { AudioRouter.shizukuRunning() }
    val granted = remember(tick) { AudioRouter.shizukuGranted() }
    val outputs = remember(tick) { AudioRouter.outputs(ctx) }
    val apps = remember {
        val pm = ctx.packageManager
        pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .map { it.activityInfo.applicationInfo }
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 || it.packageName.contains("music") }
            .distinctBy { it.uid }
            .map { AppItem(it.loadLabel(pm).toString(), it.uid) }
            .sortedBy { it.label.lowercase() }
    }
    var app by remember { mutableStateOf<AppItem?>(null) }
    var device by remember { mutableStateOf<AudioDeviceInfo?>(null) }
    var result by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(Modifier.padding(start = 4.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = Color.White) }
            Text("Audio Lab (test)", style = MaterialTheme.typography.headlineSmall, color = Color.White)
        }

        BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(if (granted) Good else Warn, 12)
                HSpace(12)
                Text(when {
                    granted -> "Shizuku ready"
                    running -> "Shizuku running, permission needed"
                    else -> "Shizuku not running. Install it and start it with wireless debugging."
                }, color = Color.White, modifier = Modifier.weight(1f))
            }
            if (running && !granted) {
                Spacer(Modifier.height(10.dp))
                Button(onClick = { AudioRouter.requestShizuku() }, colors = ButtonDefaults.buttonColors(containerColor = BoatRed)) { Text("Allow") }
            }
        }

        Text("1. Output", color = Muted, modifier = Modifier.padding(20.dp, 16.dp, 20.dp, 6.dp))
        FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
            outputs.forEach { d -> Chip(AudioRouter.label(d), device?.id == d.id) { device = d } }
            if (outputs.isEmpty()) Text("No outputs found", color = Muted)
        }

        Text("2. App", color = Muted, modifier = Modifier.padding(20.dp, 16.dp, 20.dp, 6.dp))
        BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
            apps.forEach { a ->
                Text(a.label, color = if (app?.uid == a.uid) BoatRed else Color.White,
                    modifier = Modifier.fillMaxWidth().clickable { app = a }.padding(vertical = 8.dp))
            }
        }

        Spacer(Modifier.height(16.dp))
        Row(Modifier.padding(horizontal = 16.dp)) {
            Button(
                enabled = granted && app != null && device != null,
                onClick = { result = AudioRouter.apply(ctx, mapOf(app!!.uid to device!!)) ?: "Applied: ${app!!.label} → ${AudioRouter.label(device!!)}. Play something in it now." },
                colors = ButtonDefaults.buttonColors(containerColor = BoatRed),
            ) { Text("Apply route") }
            HSpace(10)
            Button(enabled = granted, onClick = { result = AudioRouter.apply(ctx, emptyMap()) ?: "Cleared" },
                colors = ButtonDefaults.buttonColors(containerColor = CardBg2)) { Text("Clear") }
        }
        result?.let {
            BCard(Modifier.padding(16.dp).fillMaxWidth(), color = CardBg2) { Text(it, color = Color.White) }
        }
        Spacer(Modifier.height(24.dp))
    }
}
