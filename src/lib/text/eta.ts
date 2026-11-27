/** How long a job takes and has left, written the same way in every feature. */

/** «3 min», «1 h», «1 h 10 min»; at least a minute. */
export function duration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/**
 * Minutes the work `left` takes at the pace so far: `done` of the same units took `elapsedMs`. Undefined before
 * anything is done.
 */
export function leftByPace(
  elapsedMs: number,
  done: number,
  left: number,
): number | undefined {
  if (done <= 0) return undefined;
  return (elapsedMs / 60_000 / done) * left;
}

/** «≈12 min left». */
export function leftText(minutes: number): string {
  return `≈${duration(minutes)} left`;
}

/** «45 s», «3 min 12 s», «1 h 5 min». */
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}
