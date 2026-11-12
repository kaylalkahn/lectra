/* Cassette art: each recording gets its own shell, label, accent and tape wind (from the original design). */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function hash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

const skins = [['#2a2a28', '#ece7da', '#c8553d'], ['#33302b', '#e4dcc4', '#2f6b5e'], ['#262a2e', '#e9e6dd', '#c9a227'],
  ['#2d2a33', '#ebe4e0', '#7b6fd0'], ['#2b302b', '#e8e5d6', '#b5496e'], ['#30282a', '#e6e0d2', '#3f79a8']];

function reel(x, r) {
  return `<g class="reel"><circle cx="${x}" cy="83" r="${r}" fill="#3a2a1e"/><circle cx="${x}" cy="83" r="${r - 3}" fill="none" stroke="#4b3727" stroke-width=".8"/><circle cx="${x}" cy="83" r="8" fill="#ece7da"/><circle cx="${x}" cy="83" r="6.3" fill="none" stroke="#0d0d0c" stroke-width="3" stroke-dasharray="3.3 3.3"/><circle cx="${x}" cy="83" r="3.6" fill="#0d0d0c"/></g>`;
}
function screw(x, y) {
  return `<circle cx="${x}" cy="${y}" r="3.5" fill="#5a5953" stroke="rgba(0,0,0,.45)"/><path d="M${x - 2.4} ${y + .8}l4.8 -1.6" stroke="rgba(0,0,0,.6)"/>`;
}
export function cassette(title, sub, seed) {
  const k = skins[seed % skins.length], a = 12 + (seed >> 3) % 6, b = 29 - a, alt = (seed >> 5) % 2, tx = alt ? 44 : 30,
    n = title.length > 22 ? title.slice(0, 21) + '…' : title;
  const deco = alt ? `<rect x="20" y="14" width="12" height="90" fill="${k[2]}"/>` : `<rect x="20" y="14" width="220" height="12" fill="${k[2]}"/>`;
  return `<svg viewBox="0 0 260 168" role="img" aria-label="Cassette: ${esc(title)}">`
    + `<rect x="2" y="2" width="256" height="164" rx="12" fill="${k[0]}" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/><rect x="6" y="6" width="248" height="156" rx="9" fill="none" stroke="rgba(255,255,255,.06)"/>`
    + `<rect x="20" y="14" width="220" height="90" rx="4" fill="${k[1]}"/>${deco}`
    + `<text x="${tx}" y="${alt ? 44 : 48}" font-family="IBM Plex Mono,monospace" font-size="13" fill="#1c1c1a">${esc(n)}</text>`
    + `<text x="${tx}" y="${alt ? 57 : 60}" font-family="IBM Plex Mono,monospace" font-size="9" fill="#6a665b">${esc(sub)}</text>`
    + `<rect x="72" y="66" width="116" height="34" rx="17" fill="#0d0d0c" stroke="#55534c" stroke-width="1.5"/>`
    + `<path d="M${100 + a} 83H${160 - b}" stroke="#3a2a1e" stroke-width="1.5"/>${reel(100, a)}${reel(160, b)}`
    + `<rect x="80" y="69" width="100" height="5" rx="2.5" fill="#fff" opacity=".09"/>`
    + `<path d="M44 166L58 118H202L216 166Z" fill="#0f0f0e" stroke="#4a4944" stroke-width="1.5"/>`
    + `<circle cx="80" cy="148" r="5.5" fill="#6b6962"/><circle cx="180" cy="148" r="5.5" fill="#6b6962"/><circle cx="112" cy="152" r="3.5" fill="#000"/><circle cx="148" cy="152" r="3.5" fill="#000"/>`
    + `${screw(12, 12)}${screw(248, 12)}${screw(12, 156)}${screw(248, 156)}</svg>`;
}
