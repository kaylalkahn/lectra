# Lectra: Tasks

- [x] 1. Scaffold project, spec, .gitignore, env example
- [x] 2. Server: db schema, auth, rate limit
- [x] 3. Server: lectures, chunk upload, finish/recover, media streaming, pins
- [x] 4. Client: port original design into public/ (css + html), auth overlay
- [x] 5. Client: real recording (screen), pause, drift-free clock, chunk upload
- [x] 6. Client: slides mode (PDF/images -> canvas stream)
- [x] 7. Client: pins with notes, prev/next
- [x] 8. Client: library, player dialog, rename/delete/download, stats/streak
- [x] 9. API tests (node:test)
- [x] 10. Browser end-to-end test with fake media devices
- [x] 11. README with setup + honest limitations

## Hardening pass
- [x] 12. Self-host fonts (no third-party requests); tighten CSP
- [x] 13. Property-based tests (fast-check): time formatting, streaks, chunk reassembly with retries
- [x] 14. Steering docs (product, tech, design) and agent hooks (test-on-save, protect-.kiro)
- [x] 15. Fix: Enter after a mouse click on Record/Pause stopped/toggled instead of pinning (regression test in e2e)
- [x] 16. Fix: clock jumped back while saving; rate limiter counted successful logins; AudioContext could hang/record silence; README Node version (needs 22.13+); graceful DB close on shutdown
