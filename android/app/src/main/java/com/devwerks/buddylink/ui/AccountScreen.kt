package com.devwerks.buddylink.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.devwerks.buddylink.R
import com.devwerks.buddylink.data.Store
import com.devwerks.buddylink.data.Sync
import kotlinx.coroutines.launch

fun syncText(): String = when {
    Sync.busy -> "Syncing…"
    Sync.error != null -> Sync.error!!
    Sync.lastSync == 0L -> "Not synced yet"
    else -> "Synced " + ago(Sync.lastSync)
}

fun ago(t: Long): String {
    val s = (System.currentTimeMillis() - t) / 1000
    return when {
        s < 60 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        else -> "${s / 86_400} d ago"
    }
}

@Composable
fun AccountScreen(onBack: () -> Unit) {
    BackHandler { onBack() }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = Color.White) }
        }
        if (Sync.signedIn) {
            Column(Modifier.padding(horizontal = 20.dp)) {
                BuddyImage(R.raw.buddy_happy, Modifier.size(120.dp))
                Text("Your account", style = MaterialTheme.typography.headlineLarge, color = Color.White)
                Text(Sync.email ?: "", style = MaterialTheme.typography.titleMedium, color = BoatRed)
                Spacer(Modifier.height(16.dp))
            }
            BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(if (Sync.error != null) Warn else Good)
                    HSpace(10)
                    Text(syncText(), color = Color.White, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    if (Sync.busy) CircularProgressIndicator(color = BoatRed, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.height(6.dp))
                Text("${Store.tasks.size} tasks · same list as Desktop Buddy on your computer. Changes on either side show up on the other.",
                    color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { scope.launch { Sync.syncNow() } }, enabled = !Sync.busy,
                    shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.buttonColors(containerColor = BoatRed, contentColor = Color.White),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) { Text("Sync now", style = MaterialTheme.typography.titleMedium) }
            }
            Spacer(Modifier.height(12.dp))
            BCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
                Text("Habits and notes stay on this phone for now; only tasks sync with your account.", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = { Sync.signOut() }, shape = RoundedCornerShape(14.dp),
                modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(50.dp),
            ) { Text("Sign out", color = Color.White) }
            Spacer(Modifier.height(24.dp))
        } else {
            SignInForm()
        }
    }
}

@Composable
private fun SignInForm() {
    val scope = rememberCoroutineScope()
    var register by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var server by rememberSaveable { mutableStateOf(Sync.DEFAULT_SERVER) }
    var showServer by rememberSaveable { mutableStateOf(false) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    Column(Modifier.padding(horizontal = 20.dp)) {
        BuddyImage(R.raw.buddy_walk, Modifier.size(120.dp))
        Text(if (register) "Create account" else "Sign in", style = MaterialTheme.typography.headlineLarge, color = Color.White)
        Text("Use the same account as Desktop Buddy on your computer to see and edit the same tasks.",
            style = MaterialTheme.typography.bodyMedium, color = Muted)
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            value = email, onValueChange = { email = it.take(200) }, label = { Text("Email") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            shape = RoundedCornerShape(16.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it.take(200) }, label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            shape = RoundedCornerShape(16.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
        )
        if (showServer) {
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = server, onValueChange = { server = it.take(300) }, label = { Text("Server") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                shape = RoundedCornerShape(16.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
            )
        }
        val err = error
        if (err != null) {
            Spacer(Modifier.height(10.dp))
            Text(err, color = BoatRed, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(18.dp))
        Button(
            onClick = {
                busy = true
                error = null
                scope.launch {
                    error = Sync.signIn(server, email, password, register)
                    busy = false
                    if (error == null) password = ""
                }
            },
            enabled = !busy && email.contains('@') && password.length >= 8,
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = BoatRed, contentColor = Color.White, disabledContainerColor = CardBg2),
            modifier = Modifier.fillMaxWidth().height(54.dp),
        ) {
            if (busy) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            else Text(if (register) "Create account" else "Sign in", style = MaterialTheme.typography.titleMedium)
        }
        if (busy) {
            Spacer(Modifier.height(8.dp))
            Text("The server may take up to a minute to wake up the first time.", color = Muted, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = { register = !register; error = null }) {
            Text(if (register) "Already have an account? Sign in" else "New here? Create an account", color = Color.White)
        }
        TextButton(onClick = { showServer = !showServer }) {
            Text(if (showServer) "Hide server setting" else "Advanced: server address", color = Muted)
        }
        Text("Password is at least 8 characters.", color = Muted, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(24.dp))
    }
}
