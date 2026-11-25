import { describe, expect, it } from "vitest";
import { estimate, friendly } from "./messages.ts";

describe("estimate", () => {
  it("counts the upload of each video and the second render", () => {
    expect(estimate({ separated: true, youtube: true })).toBe(
      "Takes ≈2 min, both ≈4 min.",
    );
    expect(estimate({ separated: false, youtube: true })).toBe(
      "Takes ≈3–4 min, both ≈5–6 min.",
    );
    expect(estimate({ separated: true, youtube: false })).toBe(
      "Takes ≈1 min, both ≈2 min.",
    );
  });
});

describe("friendly", () => {
  it.each([
    [
      'YouTube 403: {"error":{"errors":[{"reason":"quotaExceeded"}]}}',
      "today's YouTube upload limit is used up, try tomorrow",
    ],
    [
      'YouTube 400: {"error":{"errors":[{"reason":"uploadLimitExceeded"}]}}',
      "today's YouTube upload limit is used up, try tomorrow",
    ],
    ["Google: access_denied", "YouTube sign-in was cancelled"],
    ["Google: expired_token", "the sign-in code expired, send the link again"],
    ["fetch failed", "no internet connection"],
    [
      "DownloadError: ERROR: [youtube] x: Video unavailable",
      "couldn't download the clip from YouTube",
    ],
    [
      "karaoke.py exited with code 1",
      "processing failed, details in the bot's log",
    ],
    ["YouTube 500: <html>oops</html>", "YouTube answered with error 500"],
    ["The lyrics are empty.", "The lyrics are empty."],
  ])("%s", (raw, text) => {
    expect(friendly(new Error(raw))).toBe(text);
  });
});
