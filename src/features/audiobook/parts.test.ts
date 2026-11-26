import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  audioTitle,
  describeAllParts,
  describeParts,
  partKey,
  partMessage,
  partsOf,
  pendingParts,
  readParts,
} from "./parts.ts";

const LONG = "слово ".repeat(100);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "parts-"));
});

const track = (index: number, text = LONG) => ({
  index,
  name: `${String(index + 1).padStart(3, "0")} T${index + 1}`,
  title: `T${index + 1}`,
  text,
});
const part = (...indexes: number[]) => ({
  number: 1,
  tracks: indexes.map((i) => track(i)),
});

describe("partsOf", () => {
  it("numbers the parts from 1", () => {
    const parts = partsOf([
      track(0, "а".repeat(30_000)),
      track(1, "а".repeat(30_000)),
    ]);
    expect(parts.map((p) => p.number)).toEqual([1, 2]);
    expect(partKey(parts[1]!)).toBe("002 T2|002 T2");
  });
});

describe("partMessage", () => {
  it("shows the number, the tracks and the time, then the escaped description", () => {
    const long = {
      number: 3,
      tracks: [track(6, "а".repeat(23_000)), track(8, "а".repeat(23_000))],
    };
    expect(partMessage(long, "Про <море>")).toBe(
      "🎧 <b>Part 3</b> · tracks 7–9 · ≈1 h\n\nПро &lt;море&gt;",
    );
  });

  it("says «track» for one track and minutes under an hour", () => {
    expect(
      partMessage({ number: 1, tracks: [track(0, "а".repeat(7700))] }),
    ).toBe("🎧 <b>Part 1</b> · track 1 · ≈10 min");
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

describe("describeParts", () => {
  it("describes a part once with haiku, saves it, and does not call again", async () => {
    const run = vi.fn(async () => " Про море. ");
    const p = part(0, 1);
    await describeParts(dir, [p], { run })(p);
    expect(await readParts(dir)).toEqual({ "001 T1|002 T2": "Про море." });
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Track: T1"),
      undefined,
      {
        model: "haiku",
      },
    );
    await describeParts(dir, [p], { run })(p);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("sends at most about 15000 characters", async () => {
    const run = vi.fn(async (_p: string, _i: string) => "x");
    const p = {
      number: 1,
      tracks: [0, 1, 2].map((i) => track(i, "а".repeat(20_000))),
    };
    await describeAllParts(dir, [p], { run });
    expect(run.mock.calls[0]![1].length).toBeLessThan(15_200);
  });

  it("skips a tiny part", async () => {
    const run = vi.fn(async () => "x");
    const p = { number: 1, tracks: [track(0, "short")] };
    await describeParts(dir, [p], { run })(p);
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves a failed part out and goes on", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("Друга.");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = part(0);
    const b = part(1);
    const wait = describeParts(dir, [a, b], { run });
    await wait(a);
    await wait(b);
    expect(await readParts(dir)).toEqual({ "002 T2|002 T2": "Друга." });
  });

  it("stops waiting after waitMs for a slow call", async () => {
    const run = vi.fn(() => new Promise<string>(() => {}));
    const p = part(0);
    await describeParts(dir, [p], { run, waitMs: 10 })(p);
    expect(await readParts(dir)).toEqual({});
  });
});

describe("readParts", () => {
  it("is empty for a missing or damaged file", async () => {
    expect(await readParts(dir)).toEqual({});
    await writeFile(join(dir, "parts.json"), "{oops");
    expect(await readParts(dir)).toEqual({});
    expect(await readFile(join(dir, "parts.json"), "utf8")).toBe("{oops");
  });
});

describe("pendingParts", () => {
  it("lists the parts without a description", async () => {
    await writeFile(join(dir, "parts.json"), '{"001 T1|001 T1":"Є."}');
    const parts = [part(0), part(1)];
    expect(await pendingParts(dir, parts)).toEqual([parts[1]]);
  });
});

describe("describeAllParts", () => {
  it("waits for every part, reports usage and progress", async () => {
    const usage = {
      calls: 1,
      input: 1,
      output: 1,
      cacheWrite: 0,
      cacheRead: 0,
      costUsd: 0.01,
    };
    const run = vi.fn(
      async (_p: string, _i: string, onUsage?: (u: typeof usage) => void) => {
        onUsage?.(usage);
        return "Опис.";
      },
    );
    const onUsage = vi.fn();
    const onDone = vi.fn();
    await describeAllParts(dir, [part(0), part(1)], { run, onUsage, onDone });
    expect(Object.keys(await readParts(dir))).toEqual([
      "001 T1|001 T1",
      "002 T2|002 T2",
    ]);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
