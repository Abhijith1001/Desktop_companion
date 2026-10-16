package com.devwerks.buddylink.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.devwerks.buddylink.Reminders
import com.devwerks.buddylink.data.Store
import kotlinx.coroutines.delay

private enum class Mode(val label: String, val minutes: Int) { Focus("Focus", 25), Short("Short break", 5), Long("Long break", 15) }

private const val ALARM_ID = "focus-timer"

@Composable
fun FocusScreen() {
    val ctx = LocalContext.current
    var mode by rememberSaveable { mutableStateOf(Mode.Focus) }
    // Running: endAt > 0. Paused/idle: remaining holds what's left.
    var endAt by rememberSaveable { mutableLongStateOf(0L) }
    var remaining by rememberSaveable { mutableLongStateOf(Mode.Focus.minutes * 60_000L) }
    var now by rememberSaveable { mutableLongStateOf(System.currentTimeMillis()) }

    val total = mode.minutes * 60_000L
    val running = endAt > 0
    val left = if (running) (endAt - now).coerceAtLeast(0) else remaining

    LaunchedEffect(running) {
        while (endAt > 0) {
            now = System.currentTimeMillis()
            if (endAt - now <= 0) {
                endAt = 0
                remaining = total
                if (mode == Mode.Focus) Store.focusDone()
                break
            }
            delay(250)
        }
    }

    fun setMode(m: Mode) {
        mode = m
        endAt = 0
        remaining = m.minutes * 60_000L
        Reminders.cancel(ctx, ALARM_ID)
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
        ScreenHeader("Focus", "${Store.focusToday.intValue} session${if (Store.focusToday.intValue == 1) "" else "s"} done today")
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Mode.entries.forEach { m -> Chip(m.label, mode == m) { setMode(m) } }
        }
        Spacer(Modifier.height(32.dp))
        Box(Modifier.size(270.dp), contentAlignment = Alignment.Center) {
            val progress = if (total > 0) left.toFloat() / total else 0f
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 18.dp.toPx()
                drawArc(CardBg2, 0f, 360f, false, style = Stroke(stroke))
                drawArc(BoatRed, -90f, 360f * progress, false, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val secs = (left + 999) / 1000
                Text("%02d:%02d".format(secs / 60, secs % 60), color = Color.White, fontSize = 60.sp, fontWeight = FontWeight.Black)
                Text(if (running) "Stay focused" else if (left < total) "Paused" else mode.label, color = Muted, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Spacer(Modifier.height(32.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(
                onClick = { setMode(mode) },
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.weight(1f).height(58.dp),
            ) { Text("Reset", color = Color.White, style = MaterialTheme.typography.titleMedium) }
            Button(
                onClick = {
                    if (running) {
                        remaining = (endAt - System.currentTimeMillis()).coerceAtLeast(0)
                        endAt = 0
                        Reminders.cancel(ctx, ALARM_ID)
                    } else {
                        now = System.currentTimeMillis()
                        endAt = now + remaining
                        Reminders.schedule(ctx, ALARM_ID, if (mode == Mode.Focus) "Focus session done 🎉" else "Break's over", "Buddy says: time for the next one!", endAt)
                    }
                },
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(containerColor = BoatRed, contentColor = Color.White),
                modifier = Modifier.weight(1.4f).height(58.dp),
            ) { Text(if (running) "Pause" else if (left < total) "Resume" else "Start", style = MaterialTheme.typography.titleMedium) }
        }
        Spacer(Modifier.height(16.dp))
        Text("You'll get a notification when the timer ends, even if you leave the app.", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 32.dp))
        Spacer(Modifier.height(24.dp))
    }
}
