---
inclusion: fileMatch
fileMatchPattern: "docs/**/*.{css,html,js}"
---
# Lectra: design system (preserve it)

Modern-retro tech: warm near-black, cream ink, one red "REC" accent. Tokens live in `:root` of `docs/styles.css`:
`--bg #0e0e0d`, `--panel #171716`, `--line #2b2b28`, `--ink #ece7da`, `--mute #8d8a80`, `--rec #e5483a`; fonts Instrument Sans (UI) and IBM Plex Mono (time, data).

Rules
- Reuse tokens; don't introduce new colours except cassette skins in `cassette.js`.
- Pill shapes (999px radius) for buttons and the segmented control; hairline 1px `--line` borders; film-grain overlay stays.
- Every cassette is generated SVG from `cassette.js`; reels spin only while recording, hovering or focused.
- Respect `prefers-reduced-motion`. Keep visible focus rings (`:focus-visible`). Every icon-only button needs an `aria-label`.
- Avoid glyphs the bundled fonts lack (e.g. arrows render as boxes); use words.
