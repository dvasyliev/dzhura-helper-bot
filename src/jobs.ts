/**
 * Heavy jobs (voicing a book, later karaoke and so on) load the Mac, so only one runs at a time.
 * The job is not awaited by the caller, so the bot keeps answering while it runs.
 */
let current: string | undefined;

/** Name of the running job, if any. */
export function busyWith(): string | undefined {
  return current;
}

/** Starts `job` unless another one is running; returns false if busy. */
export function startJob(name: string, job: () => Promise<void>, onError: (error: unknown) => Promise<void>): boolean {
  if (current) return false;
  current = name;
  void job()
    .catch(onError)
    .finally(() => (current = undefined));
  return true;
}
