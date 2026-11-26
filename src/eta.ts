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
