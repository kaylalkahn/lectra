# Lectra: Requirements

Lectra records a lecture (speaker's voice plus screen or slides), lets the user pin timestamped notes, and keeps everything on their account for later revision. **No AI features are in scope** (no transcription, summaries or generated study notes).

## R0 Zero-setup public link
1. Opening the public URL (GitHub Pages) goes straight to the Record screen: no account, no API key, no install.
2. Recordings, pins and the library are stored in the browser (IndexedDB) and survive reloads; nothing is uploaded.
3. The page makes no third-party network requests.

## R1 Accounts (optional server mode only)
1. When run with the Node server, a visitor can create an account with email + password (min 8 chars) and log in/out.
2. Passwords are stored as salted scrypt hashes; sessions use an HttpOnly cookie.
3. A user can only ever see, play, edit or delete their own lectures.

## R2 Recording
1. The microphone is always recorded. If mic access is denied, recording does not start and the user is told why.
2. **Screen and voice:** the user picks a screen/window/tab to share; its video (and audio, if offered) is recorded with the mic.
3. **Slides and voice:** the user loads a slide deck (PDF or images), steps through it with buttons or arrow keys, and the slide shown is recorded as video with the mic.
4. Recording can be paused/resumed; the clock reflects recorded time only and does not drift.
5. Stopping saves the lecture to the library. Ending screen share from the browser UI also stops and saves.
6. Media is uploaded in chunks while recording, so a crashed/closed tab keeps what was captured so far; on next load the interrupted lecture is recovered.
7. The topic and capture mode are locked while recording.

## R3 Pins
1. Pressing Enter (or the "Pin moment" button) while recording adds a pin at the current time.
2. Each pin has an editable note; pins can be deleted.
3. Previous/next pin buttons move focus through the pin list.

## R4 Library
1. Library lists the user's lectures as cassettes with name, date, duration, mode, pin count, with search by name.
2. Opening a lecture plays the recording; clicking a pin seeks to it.
3. The user can rename, delete (with confirmation), and download a lecture, and edit/delete its pins.
4. Stats show lectures saved, total recorded time, and a real consecutive-day streak.

## R5 Quality
1. Visual design of the original HTML is preserved.
2. Works with keyboard; respects reduced motion.
3. Unsupported browsers (no MediaRecorder / getDisplayMedia) get a clear message.
4. Setup needs only Node 22+ and `npm install`.
