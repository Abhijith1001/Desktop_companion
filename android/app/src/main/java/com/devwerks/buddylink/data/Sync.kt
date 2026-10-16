package com.devwerks.buddylink.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

// Signs in to the same Desktop Buddy account as the computer and keeps tasks
// in step with it: push queued edits, then pull what changed (same protocol
// as the desktop app's electron/sync/client.js).
object Sync {
    const val DEFAULT_SERVER = "https://desktop-buddy-server.onrender.com"

    private lateinit var prefs: SharedPreferences
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val lock = Mutex()
    private var pending: Job? = null

    var email by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var lastSync by mutableLongStateOf(0L)
        private set

    private var token: String? = null
    private var server: String = DEFAULT_SERVER
    private var cursor: String? = null

    val signedIn: Boolean get() = email != null

    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        prefs = ctx.applicationContext.getSharedPreferences("sync", Context.MODE_PRIVATE)
        token = prefs.getString("token", null)
        email = if (token != null) prefs.getString("email", null) else null
        server = prefs.getString("server", DEFAULT_SERVER) ?: DEFAULT_SERVER
        cursor = prefs.getString("cursor", null)
        lastSync = prefs.getLong("lastSync", 0)
        Store.syncing = { token != null }
        Store.onLocalChange = { request(2000) }
    }

    // Returns an error message, or null when signed in.
    suspend fun signIn(serverUrl: String, mail: String, password: String, register: Boolean): String? {
        val base = serverUrl.trim().trimEnd('/').ifEmpty { DEFAULT_SERVER }
        if (!base.startsWith("https://") && !Regex("^http://(localhost|127\\.0\\.0\\.1|10\\.0\\.2\\.2)(:\\d+)?$").matches(base)) {
            return "The server address must start with https://"
        }
        val body = JSONObject().put("email", mail.trim()).put("password", password)
        val (code, res) = try {
            withContext(Dispatchers.IO) { http(base, "POST", if (register) "/api/auth/register" else "/api/auth/login", body, null) }
        } catch (e: IOException) {
            return "Couldn't reach the server. Check your internet and try again."
        }
        if (code !in 200..299) return res?.optString("error")?.takeIf { it.isNotBlank() } ?: "Sign-in failed ($code)"
        val tok = res?.optString("token").orEmpty()
        val user = res?.optJSONObject("user")
        if (tok.isEmpty()) return "Unexpected answer from the server"
        token = tok
        server = base
        cursor = null
        email = user?.optString("email") ?: mail.trim()
        error = null
        prefs.edit().putString("token", tok).putString("email", email).putString("server", base).remove("cursor").apply()
        Store.queueAll()
        request(0)
        return null
    }

    fun signOut() {
        token = null
        email = null
        cursor = null
        error = null
        Store.clearOutbox()
        prefs.edit().remove("token").remove("email").remove("cursor").apply()
    }

    // Debounced: a burst of edits becomes one sync.
    fun request(delayMs: Long = 0) {
        if (token == null) return
        pending?.cancel()
        pending = scope.launch {
            delay(delayMs)
            syncNow()
        }
    }

    suspend fun syncNow() {
        if (token == null) return
        lock.withLock {
            busy = true
            try {
                push()
                pull()
                lastSync = System.currentTimeMillis()
                prefs.edit().putLong("lastSync", lastSync).apply()
                error = null
            } catch (e: AuthExpired) {
                signOut()
                error = "Session expired. Please sign in again."
            } catch (e: IOException) {
                error = e.message ?: "Couldn't reach the server"
            } finally {
                busy = false
            }
        }
    }

    // Repeating tasks: the server works out the next occurrence, like the desktop.
    suspend fun completeRepeating(id: String): String? {
        val tok = token ?: return "Sign in to complete repeating tasks"
        return try {
            lock.withLock {
                val (code, res) = withContext(Dispatchers.IO) { http(server, "POST", "/api/tasks/${enc(id)}/complete", JSONObject(), tok) }
                if (code == 401) throw AuthExpired()
                if (code !in 200..299) return@withLock res?.optString("error") ?: "Couldn't complete ($code)"
                res?.optJSONObject("task")?.let { Store.applyRemote(it, force = true) }
                null
            }
        } catch (e: AuthExpired) {
            signOut()
            "Session expired. Please sign in again."
        } catch (e: IOException) {
            "Needs internet to complete a repeating task"
        }
    }

    private class AuthExpired : IOException()

    private suspend fun push() {
        val ops = Store.pendingOps()
        for (batch in ops.chunked(50)) {
            val arr = JSONArray()
            batch.forEach { op ->
                val task = Store.payload(op.taskId)
                if (task == null) Store.opDone(op.opId)
                else arr.put(JSONObject().put("opId", op.opId).put("op", op.op).put("task", task))
            }
            if (arr.length() == 0) continue
            val (code, res) = call("POST", "/api/sync/push", JSONObject().put("ops", arr))
            if (code !in 200..299) throw IOException(res?.optString("error") ?: "Sync failed ($code)")
            val results = res?.optJSONArray("results") ?: JSONArray()
            for (i in 0 until results.length()) {
                val r = results.getJSONObject(i)
                Store.opDone(r.optString("opId"))
                val task = r.optJSONObject("task")
                when (r.optString("status")) {
                    "applied" -> if (task != null) Store.applied(task)
                    "conflict" -> if (task != null) Store.applyRemote(task, force = true)
                }
            }
        }
    }

    private suspend fun pull() {
        repeat(100) {
            val q = "/api/sync/changes?limit=200" + (cursor?.let { "&since=" + enc(it) } ?: "")
            val (code, res) = call("GET", q, null)
            if (code !in 200..299 || res == null) throw IOException(res?.optString("error") ?: "Sync failed ($code)")
            val tasks = res.optJSONArray("tasks") ?: JSONArray()
            for (i in 0 until tasks.length()) Store.applyRemote(tasks.getJSONObject(i))
            val next = res.optString("cursor", "")
            if (next.isNotEmpty() && next != "null") {
                cursor = next
                prefs.edit().putString("cursor", next).apply()
            }
            if (!res.optBoolean("hasMore")) return
        }
    }

    private suspend fun call(method: String, path: String, body: JSONObject?): Pair<Int, JSONObject?> {
        val tok = token ?: throw AuthExpired()
        val r = withContext(Dispatchers.IO) { http(server, method, path, body, tok) }
        if (r.first == 401) throw AuthExpired()
        return r
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    // The free server sleeps when idle, so the first request can take a while.
    private fun http(base: String, method: String, path: String, body: JSONObject?, tok: String?): Pair<Int, JSONObject?> {
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 30_000
            c.readTimeout = 60_000
            c.setRequestProperty("Accept", "application/json")
            if (tok != null) c.setRequestProperty("Authorization", "Bearer $tok")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code < 400) c.inputStream else c.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = try { if (text.isNotBlank()) JSONObject(text) else null } catch (e: Exception) { null }
            return code to json
        } finally {
            c.disconnect()
        }
    }
}
