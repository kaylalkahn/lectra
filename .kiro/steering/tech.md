---
inclusion: always
---
# Lectra: tech conventions

- Node 22+, ESM everywhere (`"type": "module"`). Express server in `server/`, static vanilla-JS client in `public/` (no bundler, no framework).
- Database is built-in `node:sqlite` with prepared statements. Never build SQL by string concatenation with user input.
- Every `/api` route except auth requires a session; every lecture/pin query must be scoped by `user_id` (ownership is tested in `test/api.test.js`).
- Strict CSP is set in `server/app.js`: no inline scripts, no external origins. Do not loosen it to make something work.
- Keep pure logic (formatting, streaks) in small side-effect-free modules (`public/format.js`, `server/streak.js`) so it can be property-tested.
- User text goes into the DOM via `textContent`/`.value` or the `esc()` helper, never raw `innerHTML`.
- Dependencies: runtime = `express`, `pdfjs-dist` only. Dev = `fast-check`. Ask before adding more.

## Commands
- `npm start`: run on :3000. `npm test`: API + property tests. `node test/e2e.mjs`: real-browser test (needs Playwright, see README).
