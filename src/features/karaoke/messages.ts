/** Texts the karaoke shows the owner that depend on the situation. */

/** Rough time for one version and for both: separating the voice is the slow part, each video then takes ~1 min to upload. */
export function estimate({ separated, youtube }: { separated: boolean; youtube: boolean }): string {
  const [low, high] = separated ? [1, 1] : [2, 3];
  const upload = youtube ? 1 : 0;
  const range = (extra: number) => (low === high ? `${low + extra}` : `${low + extra}–${high + extra}`);
  return `Займе ≈${range(upload)} хв, обидва — ≈${range(2 * upload + 1)} хв.`;
}

const FRIENDLY: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/quotaExceeded|uploadLimitExceeded/, () => "ліміт заливок на YouTube на сьогодні вичерпано, спробуйте завтра"],
  [/Google: access_denied/, () => "вхід у YouTube скасовано"],
  [/Google: expired_token/, () => "код для входу протух, надішліть посилання ще раз"],
  [/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/, () => "немає зв'язку з інтернетом"],
  [/DownloadError/, () => "не вдалося скачати кліп з YouTube"],
  [/exited with code/, () => "збій під час обробки, подробиці в лозі бота"],
  [/^YouTube (\d+)/, (m) => `YouTube відповів помилкою ${m[1]}`],
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
