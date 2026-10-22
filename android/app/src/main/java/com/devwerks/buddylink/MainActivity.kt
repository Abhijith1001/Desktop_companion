package com.devwerks.buddylink

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import com.devwerks.buddylink.data.Store
import com.devwerks.buddylink.data.Sync
import com.devwerks.buddylink.ui.AccountScreen
import com.devwerks.buddylink.ui.AudioLabScreen
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import com.devwerks.buddylink.ui.Bg
import com.devwerks.buddylink.ui.BoatRed
import com.devwerks.buddylink.ui.BuddyTheme
import com.devwerks.buddylink.ui.FocusScreen
import com.devwerks.buddylink.ui.HabitsScreen
import com.devwerks.buddylink.ui.HomeScreen
import com.devwerks.buddylink.ui.LinkScreen
import com.devwerks.buddylink.ui.Muted
import com.devwerks.buddylink.ui.NavBg
import com.devwerks.buddylink.ui.NotesScreen
import com.devwerks.buddylink.ui.TasksScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        Sync.init(this)
        Reminders.ensureChannel(this)
        setContent { BuddyTheme { App() } }
    }
}

private enum class Tab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Rounded.Home),
    Tasks("Tasks", Icons.Rounded.CheckCircle),
    Habits("Habits", Icons.Rounded.Favorite),
    Focus("Focus", Icons.Rounded.PlayArrow),
    Notes("Notes", Icons.Rounded.Edit),
}

@Composable
private fun App() {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var showLink by rememberSaveable { mutableStateOf(false) }
    var showAccount by rememberSaveable { mutableStateOf(false) }
    var showAudio by rememberSaveable { mutableStateOf(false) }

    // Stay in step with the desktop while the app is open.
    LaunchedEffect(Sync.email) {
        while (Sync.signedIn) {
            Sync.syncNow()
            delay(60_000)
        }
    }

    Scaffold(
        containerColor = Bg,
        bottomBar = {
            if (!showLink && !showAccount && !showAudio) {
                NavigationBar(containerColor = NavBg) {
                    Tab.entries.forEach { t ->
                        NavigationBarItem(
                            selected = tab == t,
                            onClick = { tab = t },
                            icon = { Icon(t.icon, contentDescription = t.label) },
                            label = { Text(t.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Color.White, selectedTextColor = BoatRed, indicatorColor = BoatRed,
                                unselectedIconColor = Muted, unselectedTextColor = Muted,
                            ),
                        )
                    }
                }
            }
        },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            if (showAudio) {
                AudioLabScreen(onBack = { showAudio = false })
            } else if (showAccount) {
                AccountScreen(onBack = { showAccount = false })
            } else if (showLink) {
                LinkScreen(onBack = { showLink = false })
            } else {
                when (tab) {
                    Tab.Home -> HomeScreen(onOpenLink = { showLink = true }, onOpenTasks = { tab = Tab.Tasks }, onOpenAccount = { showAccount = true }, onOpenAudio = { showAudio = true })
                    Tab.Tasks -> TasksScreen()
                    Tab.Habits -> HabitsScreen()
                    Tab.Focus -> FocusScreen()
                    Tab.Notes -> NotesScreen()
                }
            }
        }
    }
}
