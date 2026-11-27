import { describe, expect, it } from "vitest";
import { duration, durationText, leftByPace, leftText } from "./eta.ts";

describe("leftByPace", () => {
  it("projects the time the work done took onto the work left", () => {
    // 2 units took 4 minutes: 6 more take 12.
    expect(leftByPace(4 * 60_000, 2, 6)).toBe(12);
  });

  it("is undefined before anything is done", () => {
    expect(leftByPace(60_000, 0, 6)).toBeUndefined();
  });
});

describe("leftText", () => {
  it("rounds to whole minutes, at least one", () => {
    expect(leftText(12.4)).toBe("≈12 min left");
    expect(leftText(0.1)).toBe("≈1 min left");
    expect(leftText(70)).toBe("≈1 h 10 min left");
  });
});

describe("duration", () => {
  it("formats durations", () => {
    expect(duration(0.2)).toBe("1 min");
    expect(duration(60)).toBe("1 h");
    expect(duration(75)).toBe("1 h 15 min");
  });
});

describe("durationText", () => {
  it("formats milliseconds", () => {
    expect(durationText(45_000)).toBe("45 s");
    expect(durationText(72_000)).toBe("1 min 12 s");
    expect(durationText(3_900_000)).toBe("1 h 5 min");
  });
});
