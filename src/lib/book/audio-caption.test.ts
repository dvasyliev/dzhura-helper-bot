import { describe, expect, it } from "vitest";
import { audioCaption, audioTitle, bookPartMessage } from "./audio-caption.ts";

const LONG = "слово ".repeat(100);
const track = (index: number, text = LONG) => ({
  index,
  name: `${String(index + 1).padStart(3, "0")} T${index + 1}`,
  title: `T${index + 1}`,
  text,
});

describe("audioCaption", () => {
  it("is the title and the estimated time, escaped", () => {
    const t = {
      ...track(26, "а".repeat(20 * 770)),
      title: "Розділ I. <Дункан>",
    };
    expect(audioCaption(t, "/a/027 X.mp3")).toBe(
      "Розділ I. &lt;Дункан&gt;\n⏱ 20 min",
    );
  });

  it("says hours over an hour", () => {
    expect(audioCaption(track(0, "а".repeat(62 * 770)), "/a/001 X.mp3")).toBe(
      "T1\n⏱ 1 h 2 min",
    );
  });

  it("shares the time between a long chapter's files and numbers the later ones", () => {
    expect(
      audioCaption(track(0, "а".repeat(60 * 770)), "/a/001 X (2).mp3", 2),
    ).toBe("T1 (2)\n⏱ 30 min");
  });
});

describe("bookPartMessage", () => {
  it("is the part's name and its tracks' time", () => {
    const tracks = [
      track(0, "а".repeat(200 * 770)),
      track(1, "а".repeat(181 * 770)),
    ];
    expect(bookPartMessage("Частина <друга>", tracks)).toBe(
      "📖 <b>Частина &lt;друга&gt;</b>\n⏱ 6 h 21 min",
    );
  });
});

describe("audioTitle", () => {
  it("is the number, a dot and the title as written; later files add their number", () => {
    const t = { ...track(0), title: "Розділ I: Риба" };
    expect(audioTitle(t, "/a/001 Розділ I_ Риба.mp3")).toBe(
      "001. Розділ I: Риба",
    );
    expect(audioTitle(t, "/a/001 X (1).mp3")).toBe("001. Розділ I: Риба");
    expect(audioTitle(t, "/a/001 X (2).mp3")).toBe("001. Розділ I: Риба (2)");
  });
});
