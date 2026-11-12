# Lectra

## ▶ [Open Lectra](https://kaylalkahn.github.io/lectra/)

**https://kaylalkahn.github.io/lectra/**:

Record your screen to capture lecture visuals and audio, including everything your professor says and shows. Lectra automatically combines both into a video you can revisit anytime, so you never have those moments of "What the hell did I write?"

Best in a recent Chrome or Edge on a desktop. Allow microphone access when asked.

---

## What it does
- **Screen and voice:** share a screen, window or tab. Its audio (if offered) is mixed with your mic.
- **Slides and voice:** load a PDF or images and step through them with buttons or the arrow keys. The slide shown plus your mic is what gets recorded.
- **Log in:** each person creates a profile (name + password) with their own private library. Lectures, notes and video are encrypted with the password (Web Crypto, AES-GCM) before they're saved.
- Pause/resume with a drift-free clock. **Enter** (or "Pin moment") pins the current time; give each pin a note.
- **Rewind while recording:** missed something? Rewind replays it while Lectra keeps recording; Fast forward takes you back to live. Both move 15 s and stop at your pins, like a tape deck. In the library player they do the same.
- Saves as it records (every 5 s). If the tab crashes or closes, the lecture is recovered next time you open Lectra.
- Library: search, play back, click a pin to jump to it, rename, delete, download the video. Real stats and day streak.

## How it works
- 100% browser-native: `MediaRecorder`, `getDisplayMedia`, Web Audio, Canvas, IndexedDB, Web Crypto. PDF slides are rendered locally with pdf.js (vendored).
- No server, no AI, no third-party requests. Recordings never leave your device unless you download them.

## Known limitations
- Profiles live in one browser on one device; they don't sync. Clearing site data deletes them; download anything you want to keep.
- Passwords can't be reset: there is no server, and the data is encrypted with them. "Forgot password?" can only delete that profile.
- Profiles protect people sharing a browser from each other. They don't protect against someone with full control of the computer (e.g. malware).
- Instant replay keeps the current recording in memory; very long screen recordings use a lot of RAM.
- Recordings are WebM from `MediaRecorder` (MP4 on Safari). Browsers write no duration header; the in-app player handles this, but some external players may not show a duration.
- Firefox can't capture tab or system audio; phones generally have no screen capture (use Slides mode).
- Tested in Chromium. Firefox and Safari are untested.
- Slide files aren't stored, only the recorded video.

## Built with Kiro
Specs, steering docs and agent hooks are in [`.kiro/`](.kiro).

MIT © 2026 Kayla Kahn
