package com.devwerks.buddylink.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// boAt-style look: true black, bold white type, one strong red accent.
val BoatRed = Color(0xFFE5202E)
val BoatRedDark = Color(0xFF7A0F17)
val Bg = Color(0xFF000000)
val CardBg = Color(0xFF141417)
val CardBg2 = Color(0xFF1F1F24)
val Line = Color(0xFF2A2A31)
val Muted = Color(0xFF8E8E98)
val Good = Color(0xFF2ED47A)
val Warn = Color(0xFFFFB020)
val NavBg = Color(0xFF0E0E10)

private val base = Typography()
private val type = Typography(
    displayMedium = base.displayMedium.copy(fontWeight = FontWeight.Black),
    headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.Black, letterSpacing = (-0.5).sp),
    headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.Black, letterSpacing = (-0.5).sp),
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Bold),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.Bold),
    labelLarge = base.labelLarge.copy(fontWeight = FontWeight.Bold),
)

@Composable
fun BuddyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = BoatRed, onPrimary = Color.White,
            secondary = BoatRed, onSecondary = Color.White,
            background = Bg, onBackground = Color.White,
            surface = CardBg, onSurface = Color.White,
            surfaceVariant = CardBg2, onSurfaceVariant = Muted,
            surfaceContainer = CardBg, surfaceContainerHigh = CardBg2, surfaceContainerHighest = CardBg2,
            surfaceContainerLow = CardBg,
            outline = Line, outlineVariant = Line,
        ),
        typography = type,
        content = content,
    )
}
