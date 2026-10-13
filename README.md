# Desktop Buddy 🐾

An animated desktop companion for Windows. It walks along your taskbar, keeps your task list, and runs to the middle of the screen when something is due. Tasks and reminders live in a local SQLite database, so everything works offline. Optional cloud sync (Express + MongoDB Atlas) keeps several computers in step.

- **Characters:** a dog, a gray cartoon cat, a Tom-style cat, a hero kid and a ranger. Each has its own animations and dialogue.
- **Task manager:** Today, Upcoming, Overdue, Completed and All views, plus search, filters and a calendar.
- **Recurring tasks:** daily, weekly, selected weekdays, every N days or every N weeks, with an optional end date. Times follow the task's IANA time zone, so daylight-saving changes don't shift them.
- **Reminder engine:** persistent, with lead times, snooze, duplicate suppression, crash recovery, quiet hours, a pause option and a policy for reminders missed while away.
- **Offline-first sync:** the app keeps an outbox and syncs through a backend with accounts. Retries are idempotent, conflicts are resolved by last writer wins, and deletes are kept as tombstones.

---

## Quick start

Requirements: Windows 10/11 and Node.js 22.5 or newer (Electron ships its own runtime).

```bash
npm install
npm start          # builds the task-manager UI and starts the app
```

Look for the buddy above your taskbar and the paw icon in the system tray.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload for the task manager, plus Electron |
| `npm start` | Production build of the UI, then runs the app |
| `npm run dist` | Builds the Windows installer into `release/` |
| `npm test` | Unit tests and sync integration tests (spins up an in-memory MongoDB) |
| `npm run test:e2e` | Drives the real Electron app with Playwright, using a temporary data folder |
| `npm run test:server` | Backend API tests |
| `npm run server` | Starts the sync API (needs `server/.env`) |

> If Electron crashes at startup with `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`, some terminals (including VS Code's extension host) set `ELECTRON_RUN_AS_NODE=1`. The npm scripts already remove it. If you run `electron .` directly, clear it first.

---

## Using it

| Action | Result |
|---|---|
| Click the buddy | Opens the task manager |
| Drag the buddy | Moves it; it remembers the spot |
| Right-click the buddy or the tray icon | Shows the menu: show/hide, add task, today's tasks, pause reminders, character, settings, exit |
| **Ctrl+Alt+B** | Shows or hides the buddy (reminders keep working) |
| **Ctrl+N** in the task manager | New task |

When a task is due, the buddy runs to the screen centre and shows a speech bubble with **Mark done**, **Snooze 5 / 10 / custom**, **Open link**, **Details** and **Dismiss**. It plays one chime and reads the reminder aloud if speech is enabled. It does not repeat itself unless you choose the *Strong* intensity, which adds a single re-chime after 5 minutes. When you respond, it walks back to its spot.

Settings worth knowing about:
- **Start with Windows:** reminders only fire while the app is running.
- **How reminders appear:** buddy only, buddy plus a Windows notification, or a Windows notification only.
- **Intensity:** subtle, normal or strong.
- **Quiet hours**, **Pause reminders** and **Missed while away** (show or skip).
- **Animation:** full, reduced or off. The Windows *reduce animations* setting is respected automatically.

---

## Architecture

```
electron/                 main process (Node) — owns all state
  main.js                 wiring, app lifecycle, power events, global shortcut
  database/               SQLite (node:sqlite, no native modules) + migrations
  services/               tasks, settings, input validation (zod)
  scheduler/              recurrence + persistent reminder engine
  notifications/          presenter: buddy bubble and/or Windows notification
  sync/                   offline-first sync client (outbox, pull, backoff)
  pet/                    buddy window renderer, characters, animation CSS, state machine
  windows/                pet window (movement, drag, multi-monitor) and task-manager window
  tray/  ipc/  preload/   tray menu, validated IPC handlers, sandboxed bridges
  dialogue.js             per-character lines for each event
shared/recurrence.js      recurrence rules, used by both the app and the server
src/                      React + Vite + Tailwind + Zustand task manager
server/                   Express + Mongoose sync API
tests/unit|integration|e2e
```

**Design rule:** the reminder engine, database and sync all run in the main process. Windows are only views. Hiding the buddy, closing the task manager or a crashed renderer never stops reminders.

### Reminder engine

- Each pending task materialises exactly one **occurrence** (`taskId@scheduledAt`). The fire time is `snoozed_until`, or the scheduled time minus the lead time.
- Delivery uses a `deliveries` row that is unique per `(occurrence, fire time)`. Its state moves **CLAIMED → DELIVERED** (once the buddy confirms the bubble is on screen) or **FAILED**.
- **Crash recovery:** a claim that isn't confirmed within 2 minutes, and isn't waiting in the on-screen queue, is retried up to 3 times. After that it is marked FAILED and logged. This gives at-least-once presentation with duplicate suppression, not a guaranteed exactly-once.
- **Missed reminders** are ones whose fire time is more than 5 minutes in the past, for example after sleep or while the app was closed:
  - `notify` (default): they are shown, and if 3 or more were missed at once they are grouped into a single summary.
  - `skip`: they are resolved silently.
- **Recurring tasks** only ever keep their next occurrence and advance past *now* when resolved, so a long absence never builds up a backlog. Completing one occurrence never completes the series.
- **Quiet hours and Pause** hold delivery until they end.
- **Scheduling:** the engine sleeps until the next fire time, but never longer than 60 seconds, so clock and time-zone changes are noticed. It also wakes on system resume or unlock and after every edit.
- **Failures are isolated:** one failing reminder never blocks the others.

### Data

| What | Where |
|---|---|
| Database | `%APPDATA%\Desktop Buddy\buddy.db` (SQLite, WAL) |
| Logs | `%APPDATA%\Desktop Buddy\logs\app.log`, JSON lines rotated at 1 MB. Logs hold task ids, never titles or credentials. |
| Cloud token | Encrypted with Windows DPAPI via Electron `safeStorage`. It is never exposed to the UI. |

Tables: `tasks`, `occurrences`, `deliveries`, `settings`, `outbox`, `activity`, `schema_migrations`. Migrations in `electron/database/migrations.js` are append-only and run in a transaction at startup. Data from v1 (`data.json`) is imported once, and the original file is renamed to `data.json.imported`.

### Sync and conflict policy

1. Every local write runs in one transaction and also adds an **outbox** row with a stable `op_id`.
2. The client pushes batches to `POST /api/sync/push`. The server records each `opId`, so a retried request is never applied twice.
3. **Conflicts are resolved by last writer wins** on the task's device-side `updatedAt`. Server writes use optimistic compare-and-set on `version`.
4. **Deletes are tombstones** (`deletedAt`). An upsert older than the delete can never bring the task back.
5. The client pulls `GET /api/sync/changes?since=<cursor>`. The cursor is `serverUpdatedAt|id`, so tasks with the same timestamp are never skipped.
6. Local changes that haven't been pushed yet always win locally until they are pushed. Network errors, 5xx and 429 responses keep the operation and back off exponentially with jitter. A 401 signs the user out of sync without touching local data.

Reminders never depend on sync.

---

## Cloud backend (optional)

1. **Create a MongoDB Atlas cluster.**
   - Add a database user.
   - Allow your server's IP addresses.
   - Copy the connection string.
2. **Configure the server:**
   ```bash
   cd server
   cp .env.example .env   # fill in MONGODB_URI and JWT_SECRET (32+ random characters)
   npm install
   npm start              # http://localhost:4000, health check at /health
   ```
3. **Connect the app:** go to **Account & sync** and enter the server URL. `http://localhost:4000` works for local testing; any other host must use `https://`.

**Deploying:** the server imports `../shared/recurrence.js`, so deploy it from the **repository root**. For example, on Render or Railway use the build command `cd server && npm ci` and the start command `node server/src/index.js`. Run it behind HTTPS and set `TRUST_PROXY=1` when a proxy terminates TLS.

API overview (every `/api` route except auth needs `Authorization: Bearer <token>`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Accounts (bcrypt, JWT HS256) |
| GET, PATCH | `/api/me`, `/api/me/preferences` | Profile and character preferences |
| GET, DELETE | `/api/me/export`, `/api/me` | Data export and account deletion |
| GET, POST | `/api/tasks` | List or create (create is idempotent by client UUID) |
| GET, PUT, DELETE | `/api/tasks/:id` | Read, update (optional `expectedVersion`) or delete (tombstone) |
| POST | `/api/tasks/:id/complete`, `/api/tasks/:id/snooze` | Complete the current occurrence or snooze |
| POST, GET | `/api/sync/push`, `/api/sync/changes` | Offline-first sync |
| GET | `/health` | Database health |

Security measures:
- **Ownership:** the user id comes only from the verified token and is enforced in every query.
- **Validation:** all input is checked with zod.
- **Rate limiting:** 20 requests per 15 minutes for auth, 600 per 15 minutes for the API.
- **Headers:** helmet is enabled.
- **Errors:** messages are generic, and stack traces only go to the logs.

**Backups:** turn on Atlas Cloud Backup (continuous or snapshots). To restore, restore the snapshot to a new cluster, point `MONGODB_URI` at it and restart the server. Devices push any changes they still hold on their next sync.

---

## Security (desktop)

- **Renderers are locked down:** every renderer runs with `contextIsolation`, `sandbox`, no Node integration, a strict CSP, a deny-all `window.open` and blocked navigation.
- **Narrow bridges:** the preloads expose named methods only (`window.buddy.*` and `window.pet.*`).
- **IPC checks:** every IPC call verifies its sender window and validates its input (`electron/services/validation.js`).
- **External links:** only `http(s)` links can be opened.
- **Sync server:** it must use HTTPS unless it is localhost.

---

## Adding a character

Add an entry to `electron/pet/characters.js`. The comment at the top lists the element ids and classes the animations use:
- `.leg`, `.leg.b`, `.arm`
- `#head`, `#tail`, `#eye-open`, `#eye-closed`, `#tongue`
- `upright: true` for two-legged characters

You can also add personality lines for it in `electron/dialogue.js`. It will show up in the gallery and the tray menu automatically.

---

## Testing

Automated:
- **Unit tests:** recurrence (daylight saving, weekdays, every N, end dates), engine (duplicates, crash retry, snooze, missed and consolidated reminders, quiet hours, pause, recurring completion), IPC validation, the animation state machine and dialogue.
- **Integration tests:** two simulated devices syncing through the real API and MongoDB, going offline and back online, retried pushes and tombstones.
- **Server tests:** auth, ownership isolation, idempotency, last writer wins, tombstones, change-feed paging and account export/delete.
- **End-to-end tests:** a reminder delivered by the real app and completed from the bubble, IPC rejection, and a reminder that came due while the app was closed shown after relaunch.

Manual checklist on Windows (things automation can't cover):
1. **Installer:** run `npm run dist` and install `release/Desktop Buddy Setup *.exe`. Launch it from the Start menu.
2. **Startup:** turn on *Start with Windows*, sign out and back in, and check the buddy appears (or only the tray icon if *Start minimized* is on).
3. **Sleep:** create a task due in 3 minutes, put the PC to sleep for 5 minutes and wake it. The reminder should appear within seconds.
4. **Restart:** create a daily task and restart Windows. The task persists and the next occurrence fires.
5. **Hide and close:** hide the buddy with Ctrl+Alt+B and close the task window. Reminders still arrive as Windows notifications.
6. **Offline:** disconnect the network, edit tasks, reconnect, and check *Account & sync* shows 0 pending.
7. **Displays:** unplug or rearrange monitors and change display scaling. The buddy should stay on a visible taskbar.
8. **Exit:** choose Exit in the tray. You should see the warning about missed reminders.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Nothing happens on `npm start` | Another copy is running (check the tray). Running it again opens its task window. |
| No sound or voice | Check *Settings → Sound & voice*, the Windows volume mixer, and that a speech voice is installed (Windows Settings → Time & language → Speech). |
| Reminders late or missing | Check *Settings → Reminders* for Pause and Quiet hours, then open the log folder and look for `reminder delivery failed`. |
| "Secure storage is not available" when signing in | Windows DPAPI is unavailable for this user account. Sync can't store a token safely, so it stays off. |
| Sync shows an error | *Account & sync* shows the message. Changes stay queued and retry automatically. `GET /health` on the server reports database status. |
| Start fresh | Exit the app, then delete `%APPDATA%\Desktop Buddy\buddy.db*`. |

## Text capture, chat & bookmarks

Save text from other Windows apps as local bookmarks, then search, organise or ask about it.

- **Capture selected text:** select text in any app and press **Ctrl+Shift+B** (configurable in Settings › Text capture). A preview card opens in **Chat**, and nothing is saved until you click *Save bookmark*.
- **Drag and drop:** drag a text selection from a browser, Word and so on onto the buddy to save it as a bookmark straight away (it says "Saved!"), or onto the Chat page to review it first. If an app can't drag text, use the shortcut or the *Capture in 3 s* button.
- **Screen reading (OCR):** off by default. Turn on *Allow screen reading* to get a second shortcut (default Ctrl+Shift+O) that reads the active window once with Windows' built-in OCR. The buddy announces every read, and screenshots stay in memory only.
- **Bookmarks page:** full-text search, filters (app, tag, date, favourites), notes, tags, copy, open source link, confirmed delete. *Settings › Privacy* has "Delete all bookmarks".
- **AI (optional):** add an Anthropic API key in Settings › AI assistant. It is stored encrypted with Windows DPAPI. Every message asks for permission before anything is sent. Without a key, the chat searches your bookmarks.
- **Notepad & Calculator:** in the sidebar and tray menu. Notes autosave to the local database. The calculator supports + − × ÷ ^ √ %, brackets and keyboard input.

### How capture works on Windows

`electron/capture/capture.ps1` runs once for each capture, using Windows PowerShell 5.1 (built into Windows, no native Node modules):

1. **UI Automation** `TextPattern` on the focused control reads the selection without touching the clipboard (WPF apps, Word, many modern apps). Password fields are refused.
2. **Clipboard fallback** (can be turned off): sends Ctrl+C, reads the text and the browser `SourceURL`, then **restores every clipboard format** it saved beforehand. It is skipped when the clipboard holds copied files.
3. Source app, window title and, for browsers, the address bar URL come from the foreground window. No URL is invented for local documents.

Limitations: elevated (admin) windows can't be read from a normal-privilege app. Some apps expose nothing (games, canvas-drawn UIs); use OCR there. In editors that copy the whole line when nothing is selected (e.g. VS Code), the fallback captures that line, so check the preview. Ctrl+Shift+B replaces the Chrome/Edge bookmarks-bar shortcut while Desktop Buddy runs; pick another in Settings if you prefer.

### Commands

```powershell
npm install          # adds @anthropic-ai/sdk (only new dependency)
npm start            # build + run the app
npm test             # unit + integration tests
npm run test:e2e     # drives the real Electron app (builds first)
npm run dist         # Windows installer (capture.ps1 is unpacked from app.asar)
```
