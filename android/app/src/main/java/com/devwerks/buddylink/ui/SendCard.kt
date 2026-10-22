package com.devwerks.buddylink.ui

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.devwerks.buddylink.FileLink

// Pick photos, videos or any files and send them to the PC over Bluetooth.
@Composable
fun SendCard(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val connected = rememberLinkStatus().startsWith("Connected")

    fun send(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val n = FileLink.sendUris(ctx, uris)
        val msg = when {
            n < 0 -> "Your PC isn't connected. Keep Bluetooth on and Desktop Buddy running."
            n == 0 -> "Couldn't open those files"
            n == 1 -> "Sending 1 file to your PC"
            else -> "Sending $n files to your PC"
        }
        Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()
    }

    val media = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(50)) { send(it) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { send(it) }

    BCard(modifier.fillMaxWidth()) {
        Text("Send to PC", style = MaterialTheme.typography.titleMedium, color = Color.White)
        Text(
            if (connected) "Saved in Downloads on your computer. Progress shows in your notifications."
            else "Connect to your PC first (Bluetooth on, Desktop Buddy running).",
            style = MaterialTheme.typography.bodySmall, color = Muted,
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SendButton("🖼️", "Photos & videos", connected, Modifier.weight(1f)) {
                media.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
            }
            SendButton("📄", "Files", connected, Modifier.weight(1f)) {
                files.launch(arrayOf("*/*"))
            }
        }
    }
}

@Composable
private fun SendButton(emoji: String, label: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier.clip(shape).background(if (enabled) BoatRed else CardBg2, shape)
            .clickable(enabled = enabled, onClick = onClick).padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(emoji, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(label, color = if (enabled) Color.White else Muted, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
    }
}
