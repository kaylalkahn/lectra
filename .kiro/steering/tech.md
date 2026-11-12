---
inclusion: always
---
# Lectra: tech conventions

- Node 22+, ESM everywhere (`"type": "module"`). Static vanilla-JS client in `docs/` (no bundler, no framework), served as-is by GitHub Pages. Optional Express server in `server/`.
- `docs/store.js` has two backends with one interface: `LocalStore` (IndexedDB, default on static hosting) and `ServerStore`. UI code talks only to `store`, never to `fetch` directly.
- All asset and API URLs in `docs/` are **relative** (the site lives under `/lectra/` on Pages).
- Database is built-in `node:sqlite` with prepared statements. Never build SQL by string concatenation with user input.
- Every `/api` route except auth requires a session; every lecture/pin query must be scoped by `user_id` (ownership is tested in `test/api.test.js`).
- Strict CSP is set in `server/app.js`: no inline scripts, no external origins. Do not loosen it to make something work.
- Keep pure logic (formatting, streaks) in small side-effect-free modules (`docs/format.js`, `docs/streak.js`) so it can be property-tested.
- User text goes into the DOM via `textContent`/`.value` or the `esc()` helper, never raw `innerHTML`.
- Dependencies: server runtime = `express` only. pdf.js is vendored in `docs/vendor/pdfjs`. Dev = `fast-check`. Ask before adding more.

## Commands
- `npm start`: run on :3000. `npm test`: API + property tests. `node test/e2e.mjs` (static/Pages build) and `MODE=server node test/e2e.mjs`: real-browser tests (need Playwright, see README).
