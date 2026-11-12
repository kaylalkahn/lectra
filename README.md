# Lectra

## ▶ [Open Lectra](https://kaylalkahn.github.io/lectra/)

**https://kaylalkahn.github.io/lectra/**: opens straight into the app. No account, no install, no API keys.

Record a lecture with the speaker's voice plus their screen or slide deck, pin timestamped notes while it runs, and revise later from a library where every lecture is a cassette. Everything runs and stays in your browser.

Best in a recent Chrome or Edge on a desktop. Allow microphone access when asked.

---

## What it does
- **Screen and voice:** share a screen, window or tab. Its audio (if offered) is mixed with your mic.
- **Slides and voice:** load a PDF or images and step through them with buttons or the arrow keys. The slide shown plus your mic is what gets recorded.
- Pause/resume with a drift-free clock. **Enter** (or "Pin moment") pins the current time; give each pin a note.
- Saves as it records (every 5 s). If the tab crashes or closes, the lecture is recovered next time you open Lectra.
- Library: search, play back, click a pin to jump to it, rename, delete, download the video. Real stats and day streak.

## How it works
- 100% browser-native: `MediaRecorder`, `getDisplayMedia`, Web Audio, Canvas, IndexedDB. PDF slides are rendered locally with pdf.js (vendored).
- No server, no AI, no third-party requests. Fonts are self-hosted. Recordings never leave your device unless you download them.
- The site is the `docs/` folder, served by GitHub Pages.

## Run it locally
```bash
npx serve docs        # or any static file server, then open the printed localhost URL
```

### Optional: server mode with accounts
`server/` is an optional Node 22.13+ backend that adds email/password accounts and stores recordings on the server. The same front end detects it automatically.
```bash
npm install && npm start   # http://localhost:3000
```
Env vars: `PORT`, `DATA_DIR`, `COOKIE_SECURE=1` behind HTTPS, `TRUST_PROXY=1` behind a proxy, `MAX_LECTURE_MB`. A `Dockerfile` is included (not build-tested).

## Tests
```bash
npm install && npm test                    # API + property-based tests (fast-check)
npm i --no-save playwright && npx playwright install chromium
node test/e2e.mjs                          # real browser vs. a Pages-style static host
MODE=server node test/e2e.mjs              # real browser vs. the optional server
```

## Known limitations
- Browser storage is per browser and per device. Clearing site data deletes your lectures; download anything you want to keep.
- Recordings are WebM from `MediaRecorder` (MP4 on Safari). Browsers write no duration header; the in-app player handles this, but some external players may not show a duration.
- Firefox can't capture tab or system audio; phones generally have no screen capture (use Slides mode).
- Tested in Chromium. Firefox and Safari are untested.
- Slide files aren't stored, only the recorded video.

## Built with Kiro
Specs, steering docs and agent hooks are in [`.kiro/`](.kiro).

## Credits
Fonts: Instrument Sans and IBM Plex Mono (SIL Open Font License). PDF rendering: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Licenses in `docs/fonts` and `docs/vendor/pdfjs`.

MIT © 2026 Kayla Kahn
