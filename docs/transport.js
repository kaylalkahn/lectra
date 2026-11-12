/* Tape-deck transport: Rewind / Fast-forward move up to `step` seconds and stop at any pin on the way,
 * like a cassette deck stopping at a marker. Pins within `grace` s behind you are skipped so repeated presses keep going. */
export function seekTarget(pins, t, dir, { step = 15, end = Infinity, grace = 1 } = {}) {
  const ats = pins.map((p) => (typeof p === 'number' ? p : p.at));
  if (dir < 0) {
    const lo = Math.max(0, t - step);
    const stops = ats.filter((a) => a >= lo && a < t - grace);
    return stops.length ? Math.max(...stops) : lo;
  }
  const hi = Math.max(t, Math.min(end, t + step));
  const stops = ats.filter((a) => a > t + 0.5 && a <= hi);
  return stops.length ? Math.min(...stops) : hi;
}
