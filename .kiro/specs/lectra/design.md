# Lectra: Design

## Stack
- **Server:** Node 22, Express, built-in `node:sqlite` (no native build), media files on disk in `DATA_DIR/media`.
- **Client:** static HTML/CSS/vanilla JS (ES modules) served from `public/`. pdf.js is served from `node_modules` for PDF slides.
- **Auth:** scrypt password hashes, random session token (stored hashed), HttpOnly SameSite=Lax cookie, in-memory rate limit on auth.

## Data model
- `users(id, email, name, pass_hash, salt, created_at)`
- `sessions(token_hash, user_id, expires_at)`
- `lectures(id uuid, user_id, name, mode, status[recording|saved], duration, mime, size, chunks, elapsed, date, created_at, updated_at)`
- `pins(id, lecture_id, at, note)`

## API (all JSON except media; all but auth require a session)
| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/signup, /login, /logout | accounts |
| GET | /api/me | current user |
| GET | /api/lectures?today=YYYY-MM-DD | saved lectures + stats |
| POST | /api/lectures | start a lecture (status=recording) |
| PUT | /api/lectures/:id/chunk?seq=N&elapsed=S | append media chunk (idempotent per seq) |
| POST | /api/lectures/:id/finish | mark saved with duration |
| POST | /api/lectures/recover | finalize interrupted recordings |
| GET/PATCH/DELETE | /api/lectures/:id | read (with pins) / rename / delete |
| GET | /api/lectures/:id/media[?download=1] | stream with Range support |
| POST | /api/lectures/:id/pins | add pin |
| PATCH/DELETE | /api/pins/:id | edit/delete pin |

## Recording pipeline (client)
mic + (display stream | slide canvas stream) -> WebAudio mix for audio -> MediaRecorder (5 s timeslice) -> sequential chunk upload queue with retry -> finish.
Slides mode draws the current slide to a visible `<canvas>` and records `canvas.captureStream()`.

## Known limits
- MediaRecorder WebM has no duration header; player applies the standard seek workaround.
- Browser support: Chromium (best), Firefox (screen audio unavailable), Safari (MP4, limited).
