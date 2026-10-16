package com.devwerks.buddylink.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.devwerks.buddylink.data.Store
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun NotesScreen() {
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    val id = editing
    if (id != null && Store.notes.any { it.id == id }) {
        NoteEditor(id) { editing = null }
        return
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Notes", if (Store.notes.isEmpty()) "Quick thoughts, saved on your phone" else "${Store.notes.size} note${if (Store.notes.size == 1) "" else "s"}")
            if (Store.notes.isEmpty()) {
                EmptyState("📝", "No notes yet", "Tap + to write something down.")
            } else {
                LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(Store.notes.toList(), key = { it.id }) { n ->
                        BCard(Modifier.fillMaxWidth(), onClick = { editing = n.id }) {
                            Text(n.title.ifBlank { "Untitled" }, style = MaterialTheme.typography.titleMedium, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (n.body.isNotBlank()) {
                                Text(n.body, style = MaterialTheme.typography.bodyMedium, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(
                                Instant.ofEpochMilli(n.updated).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("d MMM, h:mm a")),
                                style = MaterialTheme.typography.labelSmall, color = Muted,
                            )
                        }
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = { editing = Store.newNote() },
            containerColor = BoatRed, contentColor = Color.White, shape = CircleShape,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) { Icon(Icons.Rounded.Add, contentDescription = "New note") }
    }
}

@Composable
private fun NoteEditor(id: String, onClose: () -> Unit) {
    val note = Store.notes.first { it.id == id }
    var title by rememberSaveable(id) { mutableStateOf(note.title) }
    var body by rememberSaveable(id) { mutableStateOf(note.body) }

    fun close() {
        // An empty new note isn't worth keeping.
        if (title.isBlank() && body.isBlank()) Store.deleteNote(id)
        onClose()
    }
    BackHandler { close() }

    val colors = TextFieldDefaults.colors(
        focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
        focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
        cursorColor = BoatRed, focusedTextColor = Color.White, unfocusedTextColor = Color.White,
        focusedPlaceholderColor = Muted, unfocusedPlaceholderColor = Muted,
    )
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { close() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = Color.White) }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { Store.deleteNote(id); onClose() }) { Icon(Icons.Rounded.Delete, contentDescription = "Delete note", tint = Muted) }
        }
        TextField(
            value = title, onValueChange = { title = it.take(120); Store.updateNote(id, title, body) },
            placeholder = { Text("Title", style = MaterialTheme.typography.headlineMedium) },
            textStyle = MaterialTheme.typography.headlineMedium, colors = colors, singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        TextField(
            value = body, onValueChange = { body = it.take(20_000); Store.updateNote(id, title, body) },
            placeholder = { Text("Start writing…") },
            textStyle = MaterialTheme.typography.bodyLarge, colors = colors,
            modifier = Modifier.fillMaxWidth().weight(1f),
        )
    }
}
