# Lectra

Record a lecture (the speaker's voice plus their screen or slide deck), pin timestamped notes while it runs, and revise from your library later. Each lecture is a cassette. **There are no AI features.**

## Run it
Requires **Node 22.13+** (uses the built-in `node:sqlite`, which is flag-free from 22.13). No native builds, no API keys.

```bash
npm install
npm start            # http://localhost:3000
```
Microphone and screen capture only work on `localhost` or HTTPS.

Config (environment variables, see `.env.example`): `PORT`, `DATA_DIR` (SQLite db + recordings, default `./data`), `COOKIE_SECURE=1` when served over HTTPS, `TRUST_PROXY=1` behind a reverse proxy, `MAX_LECTURE_MB`.

## What it does
- Accounts (email + password), per-user private library.
- **Screen and voice:** share a screen/window/tab; its audio (if offered) is mixed with the mic.
- **Slides and voice:** load a PDF or images, change slides with buttons or arrow keys; the slide canvas plus mic is recorded.
- Pause/resume, drift-free clock, Enter (or "Pin moment") to pin, editable pin notes, prev/next pin.
- Chunked upload every 5 s: if the tab dies mid-lecture, what was uploaded is recovered on next login.
- Library: search, player with pin seeking, rename, delete, download, real stats and day streak.

## Tests
```bash
npm test                                   # API tests (auth, ownership, chunks, Range, streak, recovery)
npm i --no-save playwright && npx playwright install chromium
node test/e2e.mjs                          # real-browser flow with fake mic/screen devices
```

## Known limitations
- Recordings are WebM from `MediaRecorder` (MP4 on Safari). Browsers write no duration header, so the player uses a seek workaround; downloaded files may show no duration in some players.
- Firefox can't capture screen audio; mobile browsers generally have no screen capture (the app falls back to Slides mode).
- Only tested in Chromium. Safari/Firefox are untested.
- Recovery of an interrupted recording runs on next login; a second tab recording simultaneously would be finalized by it.
- No password reset, email verification, or account deletion yet. Storage is local disk, not object storage.
- Slide images are read in the browser; the slides themselves aren't saved, only the recorded video.
- Fonts (Instrument Sans, IBM Plex Mono; SIL OFL) are self-hosted in `public/fonts`, so the app makes no third-party requests.
