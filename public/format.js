/* Pure time-formatting helpers (shared by the UI and the property tests). */
export const pad = (v) => String(v).padStart(2, '0');
export const fmt = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
export const short = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${Math.floor(s / 3600)}h ${pad(Math.floor(s % 3600 / 60))}m`);
