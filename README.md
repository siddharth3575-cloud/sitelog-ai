# Site Log — AI Field Records

A pocket app for exactly the workflow you described: see something worth
remembering on site → snap a photo → say or type a note → get a clean,
tagged, organized record. Works offline, installs like a real app on your
phone, no Play Store needed.

This is a **PWA** (Progressive Web App) — a website that installs and
behaves like a native app. I went this route instead of a true native
`.apk` because it needs zero build tooling on your end (no Android
Studio), updates instantly when you edit the files, and everything —
camera, mic, offline storage — works the same way. If you later want a
real Play Store app, this same code can be wrapped with a tool like
Capacitor with minimal changes.

## What it does

- **Capture**: tap "New Entry" → take a photo (opens your camera directly)
  or pick from gallery.
- **Note**: type a note, or tap the mic to dictate (uses your phone's
  built-in speech recognition — works offline-ish, no extra setup).
- **AI organize**: tap "Organize with AI" — Claude reads your photo + note
  together and returns a clean title, a tidied-up note, a category
  (Safety / Quality / Progress / Material / Issue / General), and a guess
  at which station you're at.
- **Save**: the record is stored locally on your phone immediately
  (IndexedDB — survives app restarts, works fully offline).
- **Sync**: if you set up the optional Google Apps Script backend below,
  every save also pushes the photo to a Drive folder and a row to a
  Google Sheet — so you always have a browsable master log, same pattern
  as your SiteLog POI app.
- **Search & filter**: by category chip or free-text search across all
  records.

Everything (AI key, sync URL, station list) is stored only on your
phone in browser storage — nothing goes through a server I control.

## Part 1 — Install the app on your phone

1. Copy this whole folder (`index.html`, `app.js`, `manifest.webmanifest`,
   `sw.js`, `icons/`) to a place your phone's browser can reach it as a
   website. Easiest free options:
   - **GitHub Pages** (same as your SiteLog app) — push this folder to a
     repo, enable Pages, done.
   - **Google Drive**: not directly servable as a website — use GitHub
     Pages or Netlify Drop (netlify.com/drop — drag the folder in, get a
     URL in seconds, free, no account needed for a quick one).
2. Open that URL in Chrome on your Android phone.
3. Tap the **⋮** menu → **Install app** (or you'll see an "Add Site Log to
   Home screen" prompt automatically). It now behaves like any other app
   — its own icon, opens full-screen, works offline.

## Part 2 — Get an Anthropic API key (for the AI organizing step)

1. Go to console.anthropic.com and create an API key (needs a small
   prepaid credit balance — this is pay-per-use, typically a fraction of
   a rupee per record with Haiku).
2. In the app, tap the gear icon (top right) → paste the key into
   **Anthropic API Key** → Save.
3. That's it — "Organize with AI" will now work. The key is stored only
   in your phone's browser storage and sent directly from your phone to
   Anthropic's API (not through any server of mine).

> Cost note: with the default model (Haiku 4.5), organizing a typical
> record costs a very small fraction of a rupee. You can switch to
> Sonnet 5 in Settings if you want more accurate tagging on complex
> entries, at a somewhat higher cost per call.

### Using DeepSeek instead

Settings → **AI Provider** → DeepSeek. Get a key at platform.deepseek.com
and paste it in the same key field. DeepSeek's per-record cost is
meaningfully lower than Anthropic's.

Two real caveats, confirmed by testing:

- **Text only.** DeepSeek's `chat/completions` endpoint currently
  rejects photo input (some marketing claims otherwise, but the live
  API returns an error when a photo is attached). With DeepSeek
  selected, only your note text gets organized — the photo still
  saves with the record, it's just not seen by the AI. Switch to
  Anthropic when you want the AI to read the photo itself (e.g. a
  photo with no note).
- **Unofficial browser support.** Anthropic explicitly documents and
  supports calling its API directly from a browser with your own key.
  DeepSeek does not — it may work, or your phone's browser may block
  the request with a CORS error. If that happens, the app shows a
  network-error message; switch the provider back to Anthropic in
  Settings. If you want DeepSeek working reliably despite that, the
  fix is a tiny proxy (e.g. a free Cloudflare Worker) that forwards
  the request server-side — say the word if you want that added.

## Part 3 — Optional: sync to Google Drive + Sheets

This step is optional — the app works fully offline without it. Do this
if you want a master, browsable copy of every record outside your phone.

1. **Create a Google Sheet** (any name) to hold the log. Open it, copy
   the long ID from its URL — the part between `/d/` and `/edit`.
2. **Create a Google Drive folder** to hold the photos. Open it, copy
   its ID the same way from the URL.
3. Go to script.google.com → **New project**.
4. Delete the placeholder code and paste in the contents of
   `apps-script.gs` (included in this folder).
5. Replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` and
   `PASTE_YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE` with the IDs from steps 1–2.
6. Click **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Authorize when prompted (it's your own script, acting on your own
   Drive/Sheet — normal Google warning for personal scripts).
8. Copy the deployment URL (ends in `/exec`).
9. In the app: gear icon → **Google Apps Script Sync URL** → paste it →
   Save.

From then on, every saved record syncs in the background. You can also
tap **Sync All Pending Now** in Settings to push anything saved while
offline.

## Editing the station list

Settings → **Stations** — one per line. It's pre-filled with all 21
Aqua Line stations plus "Other / Custom Site" so you can adapt it for
NCRTC or any other site immediately.

## Files in this folder

| File | Purpose |
|---|---|
| `index.html` | App screen, layout, styling |
| `app.js` | All app logic — storage, camera, AI calls, sync |
| `manifest.webmanifest` | Makes it installable as an app |
| `sw.js` | Service worker — offline caching |
| `icons/` | App icons |
| `apps-script.gs` | Optional Drive/Sheets sync backend — paste into script.google.com |

## Notes & limits

- Voice dictation uses your phone's built-in speech engine via the
  browser (Chrome on Android supports this well). It needs an internet
  connection the first time it initializes per session.
- Photos are compressed before upload/storage (long side ~1600px) to
  keep things fast and cheap — fine for a record photo, not meant to
  replace your camera roll.
- If you ever want this repackaged into a true installable `.apk` for
  the Play Store, the same `index.html`/`app.js` can be wrapped with
  Capacitor or Trusted Web Activity with very little rework — say the
  word if you want that path later.
