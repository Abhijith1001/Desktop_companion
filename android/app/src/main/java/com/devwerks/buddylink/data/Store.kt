package com.devwerks.buddylink.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import com.devwerks.buddylink.Reminders
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.UUID

// A task as the UI sees it, read from the same JSON the server and desktop use.
data class Task(
    val id: String,
    val title: String,
    val due: Long?,          // next reminder for repeating tasks, else the due time
    val done: Boolean,
    val recurring: Boolean,
    val created: Long,
    val updated: Long,
    val deleted: Boolean,
    val version: Int,
) {
    companion object {
        fun from(o: JSONObject): Task {
            val rec = o.optJSONObject("recurrence")
            val recurring = rec != null && rec.optString("type", "none") != "none"
            val dueAt = parseIso(o.opt("dueAt"))
            val next = parseIso(o.opt("nextOccurrenceAt"))
            return Task(
                id = o.getString("id"),
                title = o.optString("title"),
                due = if (recurring) next ?: dueAt else dueAt,
                done = o.optString("status") == "COMPLETED",
                recurring = recurring,
                created = parseIso(o.opt("createdAt")) ?: 0,
                updated = parseIso(o.opt("updatedAt")) ?: 0,
                deleted = parseIso(o.opt("deletedAt")) != null,
                version = o.optInt("version", 0),
            )
        }
    }
}

data class Habit(val id: String, val name: String, val emoji: String, val days: Set<String>)
data class Note(val id: String, val title: String, val body: String, val updated: Long)
data class Op(val opId: String, val op: String, val taskId: String)

fun parseIso(v: Any?): Long? {
    val s = v as? String ?: return null
    if (s.isBlank() || s == "null") return null
    return try {
        Instant.parse(s).toEpochMilli()
    } catch (e: Exception) {
        try { OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (e2: Exception) { null }
    }
}

fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

// Everything the phone app keeps. Tasks use the server's task format, so they
// sync with the desktop; habits and notes stay on this phone.
object Store {
    private lateinit var prefs: SharedPreferences
    private lateinit var app: Context

    // Full task JSON by id, tombstones included (they must sync too).
    private val wire = LinkedHashMap<String, JSONObject>()
    private val outbox = ArrayList<Op>()

    val tasks = mutableStateListOf<Task>()
    val habits = mutableStateListOf<Habit>()
    val notes = mutableStateListOf<Note>()
    val focusToday = mutableIntStateOf(0)

    // Set by Sync: whether edits should be queued for the server, and a nudge after edits.
    var syncing: () -> Boolean = { false }
    var onLocalChange: () -> Unit = {}

    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        app = ctx.applicationContext
        prefs = app.getSharedPreferences("buddy", Context.MODE_PRIVATE)
        load()
    }

    fun today(): String = LocalDate.now().toString()

    // ---- Tasks
    fun addTask(title: String, due: Long?) {
        val now = System.currentTimeMillis()
        val o = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("title", title.trim())
            .put("description", "").put("notes", "").put("link", "").put("category", "")
            .put("priority", "MEDIUM").put("status", "PENDING")
            .put("dueAt", if (due != null) iso(due) else JSONObject.NULL)
            .put("timeZone", ZoneId.systemDefault().id)
            .put("recurrence", JSONObject.NULL)
            .put("leadMinutes", 0)
            .put("nextOccurrenceAt", if (due != null && due > now) iso(due) else JSONObject.NULL)
            .put("createdAt", iso(now)).put("updatedAt", iso(now))
            .put("completedAt", JSONObject.NULL).put("deletedAt", JSONObject.NULL)
            .put("version", 0)
        put(o, "upsert")
    }

    // One-off tasks only; repeating ones are advanced by the server (Sync.complete).
    fun toggleTask(id: String) {
        val o = wire[id]?.let { JSONObject(it.toString()) } ?: return
        val now = System.currentTimeMillis()
        if (o.optString("status") == "COMPLETED") {
            val due = parseIso(o.opt("dueAt"))
            o.put("status", "PENDING").put("completedAt", JSONObject.NULL)
                .put("nextOccurrenceAt", if (due != null && due > now) iso(due) else JSONObject.NULL)
        } else {
            o.put("status", "COMPLETED").put("completedAt", iso(now)).put("nextOccurrenceAt", JSONObject.NULL)
        }
        o.put("updatedAt", iso(now))
        put(o, "upsert")
    }

    fun deleteTask(id: String) {
        val o = wire[id]?.let { JSONObject(it.toString()) } ?: return
        val now = iso(System.currentTimeMillis())
        o.put("deletedAt", now).put("updatedAt", now).put("nextOccurrenceAt", JSONObject.NULL)
        put(o, "delete")
    }

    private fun put(o: JSONObject, op: String) {
        val id = o.getString("id")
        wire[id] = o
        if (syncing()) {
            // Only the latest state matters: drop older unsent upserts for this task.
            outbox.removeAll { it.taskId == id && it.op == "upsert" }
            outbox.add(Op(UUID.randomUUID().toString(), op, id))
        }
        changed(id)
        onLocalChange()
    }

    // ---- Used by Sync
    fun pendingOps(): List<Op> = outbox.toList()
    fun hasPending(taskId: String) = outbox.any { it.taskId == taskId }
    fun payload(taskId: String): JSONObject? = wire[taskId]?.let { JSONObject(it.toString()).apply { remove("version"); remove("snoozedUntil") } }

    fun opDone(opId: String) {
        outbox.removeAll { it.opId == opId }
        saveOutbox()
    }

    // After signing in, everything local goes up once (like the desktop does).
    fun queueAll() {
        outbox.clear()
        wire.values.forEach { o ->
            val id = o.getString("id")
            outbox.add(Op(UUID.randomUUID().toString(), if (parseIso(o.opt("deletedAt")) != null) "delete" else "upsert", id))
        }
        saveOutbox()
    }

    fun clearOutbox() {
        outbox.clear()
        saveOutbox()
    }

    // A task from the server. `force` (a conflict answer) always wins; otherwise
    // unsent local edits win, and older copies are ignored.
    fun applyRemote(o: JSONObject, force: Boolean = false) {
        val id = o.optString("id")
        if (id.isEmpty()) return
        val local = wire[id]
        if (!force && local != null) {
            if (hasPending(id)) return
            val l = Task.from(local)
            val r = Task.from(o)
            if (l.version >= r.version && l.updated >= r.updated) return
        }
        wire[id] = o
        changed(id)
    }

    // The server accepted our write: keep its copy unless we've edited again since.
    fun applied(o: JSONObject) {
        val id = o.optString("id")
        if (id.isEmpty()) return
        if (hasPending(id)) {
            wire[id]?.put("version", o.optInt("version"))
            saveTasks()
        } else {
            wire[id] = o
            changed(id)
        }
    }

    fun visible(id: String): Task? = tasks.firstOrNull { it.id == id }

    private fun changed(id: String) {
        rebuild()
        saveTasks()
        saveOutbox()
        val t = wire[id]?.let { Task.from(it) } ?: return
        if (t.deleted) Reminders.cancel(app, id) else Reminders.forTask(app, t)
    }

    private fun rebuild() {
        val list = wire.values.map { Task.from(it) }.filter { !it.deleted }.sortedByDescending { it.created }
        tasks.clear()
        tasks.addAll(list)
    }

    // ---- Habits
    fun addHabit(name: String, emoji: String) {
        habits.add(Habit(UUID.randomUUID().toString(), name.trim(), emoji, emptySet()))
        saveLocal()
    }

    fun toggleHabitToday(id: String) {
        val i = habits.indexOfFirst { it.id == id }
        if (i < 0) return
        val h = habits[i]
        val d = today()
        habits[i] = h.copy(days = if (d in h.days) h.days - d else h.days + d)
        saveLocal()
    }

    fun deleteHabit(id: String) {
        habits.removeAll { it.id == id }
        saveLocal()
    }

    // Days in a row up to today (or up to yesterday while today is still open).
    fun streak(h: Habit): Int {
        var day = LocalDate.now()
        if (day.toString() !in h.days) day = day.minusDays(1)
        var n = 0
        while (day.toString() in h.days) {
            n++
            day = day.minusDays(1)
        }
        return n
    }

    // ---- Notes
    fun newNote(): String {
        val n = Note(UUID.randomUUID().toString(), "", "", System.currentTimeMillis())
        notes.add(0, n)
        saveLocal()
        return n.id
    }

    fun updateNote(id: String, title: String, body: String) {
        val i = notes.indexOfFirst { it.id == id }
        if (i < 0) return
        notes.removeAt(i)
        notes.add(0, Note(id, title, body, System.currentTimeMillis()))
        saveLocal()
    }

    fun deleteNote(id: String) {
        notes.removeAll { it.id == id }
        saveLocal()
    }

    // ---- Focus
    fun focusDone() {
        if (prefs.getString("focusDay", "") != today()) focusToday.intValue = 0
        focusToday.intValue += 1
        prefs.edit().putString("focusDay", today()).putInt("focusCount", focusToday.intValue).apply()
    }

    // ---- Storage
    private fun load() {
        wire.clear(); outbox.clear(); habits.clear(); notes.clear()
        array("tasks2").forEach { o -> if (o.has("id")) wire[o.getString("id")] = o }
        // Tasks saved by version 2.0 of this app (before sync): convert once.
        if (wire.isEmpty()) array("tasks").forEach { old -> migrate(old)?.let { wire[it.getString("id")] = it } }
        array("outbox").forEach { o -> outbox.add(Op(o.getString("opId"), o.getString("op"), o.getString("taskId"))) }
        array("habits").forEach { o ->
            val days = o.optJSONArray("days")
            val set = HashSet<String>()
            if (days != null) for (i in 0 until days.length()) set.add(days.getString(i))
            habits.add(Habit(o.getString("id"), o.optString("name"), o.optString("emoji", "⭐"), set))
        }
        array("notes").forEach { o ->
            notes.add(Note(o.getString("id"), o.optString("title"), o.optString("body"), o.optLong("updated")))
        }
        focusToday.intValue = if (prefs.getString("focusDay", "") == today()) prefs.getInt("focusCount", 0) else 0
        rebuild()
    }

    private fun migrate(old: JSONObject): JSONObject? {
        val title = old.optString("title").trim()
        if (!old.has("id") || title.isEmpty()) return null
        val created = old.optLong("created", System.currentTimeMillis())
        val due = if (old.has("due")) old.getLong("due") else null
        val done = old.optBoolean("done")
        return JSONObject()
            .put("id", old.getString("id")).put("title", title)
            .put("description", "").put("notes", "").put("link", "").put("category", "")
            .put("priority", "MEDIUM").put("status", if (done) "COMPLETED" else "PENDING")
            .put("dueAt", if (due != null) iso(due) else JSONObject.NULL)
            .put("timeZone", ZoneId.systemDefault().id).put("recurrence", JSONObject.NULL).put("leadMinutes", 0)
            .put("nextOccurrenceAt", if (!done && due != null && due > System.currentTimeMillis()) iso(due) else JSONObject.NULL)
            .put("createdAt", iso(created)).put("updatedAt", iso(created))
            .put("completedAt", if (done) iso(created) else JSONObject.NULL).put("deletedAt", JSONObject.NULL)
            .put("version", 0)
    }

    private fun array(key: String): List<JSONObject> = try {
        val a = JSONArray(prefs.getString(key, "[]"))
        (0 until a.length()).map { a.getJSONObject(it) }
    } catch (e: Exception) {
        emptyList()
    }

    private fun saveTasks() {
        val t = JSONArray()
        wire.values.forEach { t.put(it) }
        prefs.edit().putString("tasks2", t.toString()).apply()
    }

    private fun saveOutbox() {
        val a = JSONArray()
        outbox.forEach { a.put(JSONObject().put("opId", it.opId).put("op", it.op).put("taskId", it.taskId)) }
        prefs.edit().putString("outbox", a.toString()).apply()
    }

    private fun saveLocal() {
        val h = JSONArray()
        habits.forEach { h.put(JSONObject().put("id", it.id).put("name", it.name).put("emoji", it.emoji).put("days", JSONArray(it.days.toList()))) }
        val n = JSONArray()
        notes.forEach { n.put(JSONObject().put("id", it.id).put("title", it.title).put("body", it.body).put("updated", it.updated)) }
        prefs.edit().putString("habits", h.toString()).putString("notes", n.toString()).apply()
    }
}
