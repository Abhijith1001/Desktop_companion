package com.devwerks.buddylink.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Settings
import com.devwerks.buddylink.data.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.devwerks.buddylink.R
import com.devwerks.buddylink.data.Store
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

@Composable
fun HomeScreen(onOpenLink: () -> Unit, onOpenTasks: () -> Unit, onOpenAccount: () -> Unit, onOpenAudio: () -> Unit) {
    val link = rememberLinkStatus()
    val connected = link.startsWith("Connected")
    val endOfToday = endOfToday()
    val open = Store.tasks.filter { !it.done }
    val dueToday = open.count { it.due != null && it.due < endOfToday }
    val today = Store.today()
    val habitsDone = Store.habits.count { today in it.days }
    val upNext = open.sortedWith(compareBy(nullsLast()) { it.due }).take(3)

    val hour = LocalTime.now().hour
    val greeting = when {
        hour < 12 -> "Good morning"
        hour < 17 -> "Good afternoon"
        else -> "Good evening"
    }
    val allDone = open.isEmpty() && (Store.habits.isEmpty() || habitsDone == Store.habits.size)
    val bubble = when {
        allDone && Store.tasks.isNotEmpty() -> "All done! You're on fire today 🔥"
        dueToday > 0 -> "You have $dueToday task${if (dueToday == 1) "" else "s"} for today. Let's go!"
        Store.habits.isNotEmpty() && habitsDone < Store.habits.size -> "Don't forget your habits today 💪"
        Store.tasks.isEmpty() -> "Hi! Add a task and I'll remind you."
        else -> "Nothing urgent. Enjoy your day ✨"
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader(greeting, LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, d MMMM"))) {
            IconButton(onClick = onOpenAccount) { Icon(Icons.Rounded.Person, contentDescription = "Account", tint = if (Sync.signedIn) BoatRed else Color.White) }
            IconButton(onClick = onOpenLink) { Icon(Icons.Rounded.Settings, contentDescription = "Phone link", tint = Color.White) }
        }

        // Hero: the buddy and what it has to say.
        Box(
            Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp))
                .background(Brush.linearGradient(listOf(BoatRed, BoatRedDark, Color(0xFF1A0507))))
        ) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                BuddyImage(if (allDone && Store.tasks.isNotEmpty()) R.raw.buddy_happy else R.raw.buddy_walk, Modifier.size(130.dp))
                Spacer(Modifier.size(8.dp))
                Column(Modifier.weight(1f)) {
                    Text("BUDDY", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.7f), fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(4.dp))
                    Box(Modifier.clip(RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)).background(Color.White).padding(12.dp)) {
                        Text(bubble, color = Color.Black, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Row2 {
            StatTile("$dueToday", "Due today", Modifier.weight(1f), if (dueToday > 0) BoatRed else Color.White)
            StatTile("$habitsDone/${Store.habits.size}", "Habits", Modifier.weight(1f), if (Store.habits.isNotEmpty() && habitsDone == Store.habits.size) Good else Color.White)
            StatTile("${Store.focusToday.intValue}", "Focus sessions", Modifier.weight(1f))
        }

        Spacer(Modifier.height(12.dp))
        BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), color = if (Sync.signedIn) CardBg else CardBg2, onClick = onOpenAccount) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(if (!Sync.signedIn) BoatRed else if (Sync.error != null) Warn else Good, 12)
                HSpace(12)
                Column(Modifier.weight(1f)) {
                    Text(if (Sync.signedIn) "Synced with Desktop Buddy" else "Sign in to see your desktop tasks", style = MaterialTheme.typography.titleMedium, color = Color.White)
                    Text(if (Sync.signedIn) (Sync.email ?: "") + " · " + syncText() else "Same account as on your computer", style = MaterialTheme.typography.bodySmall, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("›", style = MaterialTheme.typography.headlineMedium, color = Muted)
            }
        }

        Spacer(Modifier.height(10.dp))
        BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), onClick = onOpenLink) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(if (connected) Good else Warn, 12)
                HSpace(12)
                Column(Modifier.weight(1f)) {
                    Text(if (connected) "Linked to your PC" else "PC link", style = MaterialTheme.typography.titleMedium, color = Color.White)
                    Text(link, style = MaterialTheme.typography.bodySmall, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("›", style = MaterialTheme.typography.headlineMedium, color = Muted)
            }
        }

        Spacer(Modifier.height(10.dp))
        SendCard(Modifier.padding(horizontal = 16.dp))

        Spacer(Modifier.height(10.dp))
        BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), onClick = onOpenAudio) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Audio Lab", style = MaterialTheme.typography.titleMedium, color = Color.White)
                    Text("Test: send one app's sound to a chosen device", style = MaterialTheme.typography.bodySmall, color = Muted)
                }
                Text("›", style = MaterialTheme.typography.headlineMedium, color = Muted)
            }
        }

        Spacer(Modifier.height(20.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Up next", style = MaterialTheme.typography.titleLarge, color = Color.White, modifier = Modifier.weight(1f))
            Text("See all", color = BoatRed, style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onOpenTasks).padding(6.dp))
        }
        Spacer(Modifier.height(8.dp))
        if (upNext.isEmpty()) {
            BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), onClick = onOpenTasks) {
                Text("No tasks yet", style = MaterialTheme.typography.titleMedium, color = Color.White)
                Text("Tap to add your first one.", style = MaterialTheme.typography.bodySmall, color = Muted)
            }
        } else {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                upNext.forEach { t -> TaskRow(t) }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
