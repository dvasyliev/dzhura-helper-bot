/** Texts the karaoke shows the owner that depend on the situation. */

/** Minutes for one version without uploading: separating the voice is the slow part. */
function minutes(separated: boolean): [number, number] {
  return separated ? [1, 1] : [2, 3];
}

/** Rough time for one version and for both: separating the voice is the slow part, each video then takes ~1 min to upload. */
export function estimate({
  separated,
  youtube,
}: {
  separated: boolean;
  youtube: boolean;
}): string {
  const [low, high] = minutes(separated);
  const upload = youtube ? 1 : 0;
  const range = (extra: number) =>
    low === high ? `${low + extra}` : `${low + extra}–${high + extra}`;
  return `Takes ≈${range(upload)} min, both ≈${range(2 * upload + 1)} min.`;
}

/** The longer end of `estimate` for the versions asked, to count the time left from. */
export function expectedMinutes({
  separated,
  youtube,
  versions,
}: {
  separated: boolean;
  youtube: boolean;
  versions: number;
}): number {
  const upload = youtube ? 1 : 0;
  return minutes(separated)[1] + upload * versions + (versions - 1);
}

const FRIENDLY: [RegExp, (match: RegExpMatchArray) => string][] = [
  [
    /quotaExceeded|uploadLimitExceeded/,
    () => "today's YouTube upload limit is used up, try tomorrow",
  ],
  [/Google: access_denied/, () => "YouTube sign-in was cancelled"],
  [
    /Google: expired_token/,
    () => "the sign-in code expired, send the link again",
  ],
  [
    /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/,
    () => "no internet connection",
  ],
  [/DownloadError/, () => "couldn't download the clip from YouTube"],
  [/exited with code/, () => "processing failed, details in the bot's log"],
  [/^YouTube (\d+)/, (m) => `YouTube answered with error ${m[1]}`],
];

/** An error as the owner should read it; the bot's own messages pass through. */
export function friendly(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  for (const [pattern, say] of FRIENDLY) {
    const match = text.match(pattern);
    if (match) return say(match);
  }
  return text;
}
