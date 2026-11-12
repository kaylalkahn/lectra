---
inclusion: always
---
# Lectra: product rules

Lectra records a lecture (speaker's voice + screen or slides), lets the user pin timestamped notes, and keeps everything on their account. Each lecture is a **cassette**: the retro tape metaphor is the product's identity.

- **No AI and no paid/third-party services.** No transcription, summaries, API keys or subscriptions. Prefer browser-native APIs (MediaRecorder, getDisplayMedia, Web Audio, canvas) and local processing.
- **No third-party network requests at runtime** (fonts are self-hosted in `public/fonts`).
- The mic is always recorded. Screen mode and slides mode both produce a video.
- Never claim a feature works unless it is implemented and covered by a test or a browser check. Document limits honestly in the README.
- Requirements live in `.kiro/specs/lectra/requirements.md`. Add or change a requirement there **before** changing behaviour.
