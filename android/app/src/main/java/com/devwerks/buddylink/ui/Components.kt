package com.devwerks.buddylink.ui

import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.widget.ImageView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.devwerks.buddylink.LinkServer
import kotlinx.coroutines.delay

@Composable
fun ScreenHeader(title: String, subtitle: String? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 20.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineLarge, color = Color.White)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        trailing?.invoke()
    }
}

@Composable
fun BCard(modifier: Modifier = Modifier, color: Color = CardBg, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    var m = modifier.clip(shape).background(color, shape)
    if (onClick != null) m = m.clickable(onClick = onClick)
    Column(m.padding(16.dp), content = content)
}

@Composable
fun Dot(color: Color, size: Int = 10) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(color))
}

@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Text(
        text,
        modifier = Modifier.clip(shape).background(if (selected) BoatRed else CardBg2, shape).clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 9.dp),
        color = if (selected) Color.White else Muted,
        style = MaterialTheme.typography.labelLarge,
    )
}

@Composable
fun EmptyState(emoji: String, title: String, text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(emoji, style = MaterialTheme.typography.displayMedium)
        Spacer(Modifier.size(12.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, color = Color.White)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Muted, textAlign = TextAlign.Center)
    }
}

@Composable
fun StatTile(value: String, label: String, modifier: Modifier = Modifier, accent: Color = Color.White) {
    BCard(modifier) {
        Text(value, style = MaterialTheme.typography.headlineMedium, color = accent)
        Text(label, style = MaterialTheme.typography.bodySmall, color = Muted, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun Row2(content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) { content() }
}

@Composable
fun HSpace(w: Int) = Spacer(Modifier.width(w.dp))

// The desktop buddy's own sprite; animated where Android can play WebP animations.
@Composable
fun BuddyImage(res: Int, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            ImageView(ctx).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        val d = ImageDecoder.decodeDrawable(ImageDecoder.createSource(ctx.resources, res))
                        setImageDrawable(d)
                        if (d is AnimatedImageDrawable) d.start()
                    } else {
                        setImageDrawable(BitmapDrawable(ctx.resources, BitmapFactory.decodeResource(ctx.resources, res)))
                    }
                } catch (e: Exception) {
                    // No picture is better than a crash.
                }
            }
        },
    )
}

// The Bluetooth link's status line, refreshed while on screen.
@Composable
fun rememberLinkStatus(): String {
    var s by remember { mutableStateOf(LinkServer.status) }
    LaunchedEffect(Unit) {
        while (true) {
            s = LinkServer.status
            delay(1500)
        }
    }
    return s
}
