const DAY = 86400000;
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Consecutive-day streak ending today (or yesterday, so it stays alive until you miss a full day). */
export function streak(dates, today) {
  const set = new Set(dates);
  let cur = day(today);
  if (!set.has(iso(cur))) cur -= DAY;
  let n = 0;
  while (set.has(iso(cur))) { n++; cur -= DAY; }
  return n;
}
