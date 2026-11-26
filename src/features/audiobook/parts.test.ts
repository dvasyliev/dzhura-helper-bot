import { describe, expect, it } from "vitest";
import { audioTitle, partMessage, partsOf } from "./parts.ts";

const LONG = "слово ".repeat(100);
const track = (index: number, text = LONG) => ({
  index,
  name: `${String(index + 1).padStart(3, "0")} T${index + 1}`,
  title: `T${index + 1}`,
  text,
});

describe("partsOf", () => {
  it("numbers the parts from 1", () => {
    const parts = partsOf([
      track(0, "а".repeat(30_000)),
      track(1, "а".repeat(30_000)),
    ]);
    expect(parts.map((p) => p.number)).toEqual([1, 2]);
  });
});

describe("partMessage", () => {
  it("shows the number, the tracks and the time, then the escaped chapter titles", () => {
    const part = {
      number: 2,
      tracks: [
        { ...track(0, "а".repeat(7700)), title: "Розділ I: <Риба>" },
        { ...track(1, "а".repeat(7700)), title: "Розділ II" },
      ],
    };
    expect(partMessage(part)).toBe(
      "🎧 <b>Part 2</b> · tracks 1–2 · ≈20 min\n\n• Розділ I: &lt;Риба&gt;\n• Розділ II",
    );
  });

  it("says «track» for one track and hours over an hour", () => {
    expect(
      partMessage({ number: 3, tracks: [track(6, "а".repeat(46_000))] }),
    ).toBe("🎧 <b>Part 3</b> · track 7 · ≈1 h\n\n• T7");
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
