package com.devwerks.buddylink.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import android.widget.Toast
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.runtime.rememberCoroutineScope
import com.devwerks.buddylink.data.Store
import com.devwerks.buddylink.data.Sync
import com.devwerks.buddylink.data.Task
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Calendar

fun endOfToday(): Long = LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()

fun dueText(due: Long): String {
    val dt = LocalDateTime.ofInstant(Instant.ofEpochMilli(due), ZoneId.systemDefault())
    val time = dt.format(DateTimeFormatter.ofPattern("h:mm a"))
    val day = dt.toLocalDate()
    val today = LocalDate.now()
    return when (day) {
        today -> "Today, $time"
        today.plusDays(1) -> "Tomorrow, $time"
        today.minusDays(1) -> "Yesterday, $time"
        else -> dt.format(DateTimeFormatter.ofPattern("EEE d MMM, h:mm a"))
    }
}

private enum class Filter(val label: String) { Today("Today"), Upcoming("Upcoming"), All("All"), Done("Done") }

@Composable
fun TasksScreen() {
    var filter by rememberSaveable { mutableStateOf(Filter.Today) }
    var adding by rememberSaveable { mutableStateOf(false) }
    val end = endOfToday()
    val list = Store.tasks.filter {
        when (filter) {
            Filter.Today -> !it.done && (it.due == null || it.due < end)
            Filter.Upcoming -> !it.done && it.due != null && it.due >= end
            Filter.All -> !it.done
            Filter.Done -> it.done
        }
    }.sortedWith(compareBy(nullsLast()) { it.due })
    val openCount = Store.tasks.count { !it.done }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            val scope = rememberCoroutineScope()
            val sub = (if (openCount == 0) "You're all caught up" else "$openCount open") + (if (Sync.signedIn) " · " + syncText() else " · on this phone only")
            ScreenHeader("Tasks", sub) {
                if (Sync.signedIn) IconButton(onClick = { scope.launch { Sync.syncNow() } }, enabled = !Sync.busy) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Sync now", tint = if (Sync.busy) Muted else Color.White)
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Filter.entries.forEach { f -> Chip(f.label, filter == f) { filter = f } }
            }
            Spacer(Modifier.height(12.dp))
            if (list.isEmpty()) {
                EmptyState(if (filter == Filter.Done) "🏁" else "✅", if (filter == Filter.Done) "Nothing finished yet" else "Nothing here", "Tap + to add a task. Buddy will remind you on time.")
            } else {
                LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(list, key = { it.id }) { t -> TaskRow(t, showDelete = true) }
                }
            }
        }
        FloatingActionButton(
            onClick = { adding = true },
            containerColor = BoatRed, contentColor = Color.White, shape = CircleShape,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) { Icon(Icons.Rounded.Add, contentDescription = "Add task") }
    }
    if (adding) AddTaskSheet(onDismiss = { adding = false })
}

@Composable
fun TaskRow(t: Task, showDelete: Boolean = false) {
    val overdue = !t.done && t.due != null && t.due < System.currentTimeMillis()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val toggle = {
        if (t.recurring && !t.done) {
            scope.launch {
                val err = Sync.completeRepeating(t.id)
                Toast.makeText(ctx, err ?: "Done! Next one is scheduled.", Toast.LENGTH_SHORT).show()
            }
        } else {
            Store.toggleTask(t.id)
        }
    }
    BCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val shape = CircleShape
            Box(
                Modifier.size(28.dp).clip(shape)
                    .background(if (t.done) BoatRed else Color.Transparent, shape)
                    .border(2.dp, if (t.done) BoatRed else Muted, shape)
                    .clickable { toggle() },
                contentAlignment = Alignment.Center,
            ) {
                if (t.done) Icon(Icons.Rounded.Check, contentDescription = "Done", tint = Color.White, modifier = Modifier.size(18.dp))
            }
            HSpace(14)
            Column(Modifier.weight(1f)) {
                Text(
                    t.title, style = MaterialTheme.typography.titleMedium,
                    color = if (t.done) Muted else Color.White,
                    textDecoration = if (t.done) TextDecoration.LineThrough else null,
                )
                if (t.due != null) {
                    Text(
                        (if (overdue) "Overdue · " else if (t.recurring) "🔁 " else "⏰ ") + dueText(t.due),
                        style = MaterialTheme.typography.bodySmall, color = if (overdue) BoatRed else Muted,
                    )
                }
            }
            if (showDelete) {
                IconButton(onClick = { Store.deleteTask(t.id) }) {
                    Icon(Icons.Rounded.Delete, contentDescription = "Delete", tint = Muted)
                }
            }
        }
    }
}

@Composable
fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = BoatRed, unfocusedBorderColor = Line, cursorColor = BoatRed,
    focusedTextColor = Color.White, unfocusedTextColor = Color.White,
    focusedLabelColor = BoatRed, unfocusedLabelColor = Muted,
    focusedContainerColor = CardBg2, unfocusedContainerColor = CardBg2,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddTaskSheet(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    var title by rememberSaveable { mutableStateOf("") }
    var due by rememberSaveable { mutableStateOf<Long?>(null) }
    var choice by rememberSaveable { mutableStateOf("none") }
    val zone = ZoneId.systemDefault()

    fun at(day: LocalDate, hour: Int, min: Int = 0) = day.atTime(hour, min).atZone(zone).toInstant().toEpochMilli()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = CardBg) {
        Column(Modifier.padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp)) {
            Text("New task", style = MaterialTheme.typography.headlineSmall, color = Color.White)
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = title, onValueChange = { title = it.take(200) },
                label = { Text("What do you need to do?") }, singleLine = true,
                shape = RoundedCornerShape(16.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))
            Text("Remind me", style = MaterialTheme.typography.titleMedium, color = Color.White)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("No reminder", choice == "none") { choice = "none"; due = null }
                Chip("In 1 hour", choice == "1h") { choice = "1h"; due = System.currentTimeMillis() + 3_600_000L }
                Chip("Tonight 8 PM", choice == "tonight") {
                    choice = "tonight"
                    val t = at(LocalDate.now(), 20)
                    due = if (t > System.currentTimeMillis()) t else at(LocalDate.now().plusDays(1), 20)
                }
                Chip("Tomorrow 9 AM", choice == "tomorrow") { choice = "tomorrow"; due = at(LocalDate.now().plusDays(1), 9) }
                Chip("Pick…", choice == "pick") {
                    val c = Calendar.getInstance()
                    DatePickerDialog(ctx, { _, y, m, d ->
                        TimePickerDialog(ctx, { _, h, min ->
                            due = at(LocalDate.of(y, m + 1, d), h, min)
                            choice = "pick"
                        }, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), false).show()
                    }, c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show()
                }
            }
            val d = due
            if (d != null) {
                Spacer(Modifier.height(8.dp))
                Text("⏰ ${dueText(d)}", color = BoatRed, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    Store.addTask(title, due)
                    onDismiss()
                },
                enabled = title.isNotBlank(),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = BoatRed, contentColor = Color.White, disabledContainerColor = CardBg2),
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) { Text("Add task", style = MaterialTheme.typography.titleMedium) }
        }
    }
}
