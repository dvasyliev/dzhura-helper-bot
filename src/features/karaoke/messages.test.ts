import { describe, expect, it } from "vitest";
import { estimate, friendly } from "./messages.ts";

describe("estimate", () => {
  it("counts the upload of each video and the second render", () => {
    expect(estimate({ separated: true, youtube: true })).toBe(
      "Займе ≈2 хв, обидва — ≈4 хв.",
    );
    expect(estimate({ separated: false, youtube: true })).toBe(
      "Займе ≈3–4 хв, обидва — ≈5–6 хв.",
    );
    expect(estimate({ separated: true, youtube: false })).toBe(
      "Займе ≈1 хв, обидва — ≈2 хв.",
    );
  });
});

describe("friendly", () => {
  it.each([
    [
      'YouTube 403: {"error":{"errors":[{"reason":"quotaExceeded"}]}}',
      "ліміт заливок на YouTube на сьогодні вичерпано, спробуйте завтра",
    ],
    [
      'YouTube 400: {"error":{"errors":[{"reason":"uploadLimitExceeded"}]}}',
      "ліміт заливок на YouTube на сьогодні вичерпано, спробуйте завтра",
    ],
    ["Google: access_denied", "вхід у YouTube скасовано"],
    [
      "Google: expired_token",
      "код для входу протух, надішліть посилання ще раз",
    ],
    ["fetch failed", "немає зв'язку з інтернетом"],
    [
      "DownloadError: ERROR: [youtube] x: Video unavailable",
      "не вдалося скачати кліп з YouTube",
    ],
    [
      "karaoke.py exited with code 1",
      "збій під час обробки, подробиці в лозі бота",
    ],
    ["YouTube 500: <html>oops</html>", "YouTube відповів помилкою 500"],
    ["Текст пісні порожній.", "Текст пісні порожній."],
  ])("%s", (raw, text) => {
    expect(friendly(new Error(raw))).toBe(text);
  });
});
