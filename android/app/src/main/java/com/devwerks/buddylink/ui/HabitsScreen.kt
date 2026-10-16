package com.devwerks.buddylink.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.devwerks.buddylink.data.Habit
import com.devwerks.buddylink.data.Store
import java.time.LocalDate

private val EMOJIS = listOf("💧", "📚", "🏃", "🧘", "🍎", "😴", "💊", "✍️", "🎸", "🚭")

@Composable
fun HabitsScreen() {
    var adding by rememberSaveable { mutableStateOf(false) }
    val today = Store.today()
    val done = Store.habits.count { today in it.days }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Habits", if (Store.habits.isEmpty()) "Build a streak, one day at a time" else "$done of ${Store.habits.size} done today")
            if (Store.habits.isEmpty()) {
                EmptyState("🔥", "No habits yet", "Tap + to add one, like drinking water or reading.")
            } else {
                LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(Store.habits.toList(), key = { it.id }) { h -> HabitCard(h) }
                }
            }
        }
        FloatingActionButton(
            onClick = { adding = true },
            containerColor = BoatRed, contentColor = Color.White, shape = CircleShape,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) { Icon(Icons.Rounded.Add, contentDescription = "Add habit") }
    }
    if (adding) AddHabitDialog { adding = false }
}

@Composable
private fun HabitCard(h: Habit) {
    val today = LocalDate.now()
    val doneToday = today.toString() in h.days
    val streak = Store.streak(h)
    BCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(CardBg2), contentAlignment = Alignment.Center) {
                Text(h.emoji, style = MaterialTheme.typography.headlineSmall)
            }
            HSpace(12)
            Column(Modifier.weight(1f)) {
                Text(h.name, style = MaterialTheme.typography.titleMedium, color = Color.White)
                Text(if (streak > 0) "🔥 $streak day streak" else "Start your streak today", style = MaterialTheme.typography.bodySmall, color = if (streak > 0) Warn else Muted)
            }
            IconButton(onClick = { Store.deleteHabit(h.id) }) { Icon(Icons.Rounded.Delete, contentDescription = "Delete", tint = Muted) }
            Box(
                Modifier.size(44.dp).clip(CircleShape).background(if (doneToday) BoatRed else CardBg2).clickable { Store.toggleHabitToday(h.id) },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Rounded.Check, contentDescription = "Done today", tint = if (doneToday) Color.White else Muted) }
        }
        Spacer(Modifier.height(12.dp))
        // Last seven days, oldest first.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            (6 downTo 0).forEach { back ->
                val d = today.minusDays(back.toLong())
                val on = d.toString() in h.days
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(d.dayOfWeek.name.take(1), style = MaterialTheme.typography.labelSmall, color = if (back == 0) Color.White else Muted, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Box(Modifier.size(26.dp).clip(CircleShape).background(if (on) BoatRed else CardBg2))
                }
            }
        }
    }
}

@Composable
private fun AddHabitDialog(onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var emoji by rememberSaveable { mutableStateOf(EMOJIS[0]) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = CardBg,
        title = { Text("New habit", color = Color.White) },
        text = {
            Column {
                OutlinedTextField(
                    value = name, onValueChange = { name = it.take(60) }, singleLine = true,
                    label = { Text("e.g. Drink water") }, shape = RoundedCornerShape(16.dp), colors = fieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    EMOJIS.forEach { e ->
                        Box(
                            Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(if (e == emoji) BoatRed else CardBg2).clickable { emoji = e },
                            contentAlignment = Alignment.Center,
                        ) { Text(e, style = MaterialTheme.typography.titleLarge) }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { Store.addHabit(name, emoji); onDismiss() }, enabled = name.isNotBlank()) {
                Text("Add", color = if (name.isNotBlank()) BoatRed else Muted)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = Muted) } },
    )
}
