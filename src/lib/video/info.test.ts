import { describe, expect, it, vi } from "vitest";
import { isMusic, videoInfo } from "./info.ts";

const RAW = {
  title: "Lecture",
  channel: "Uni",
  duration: 3600,
  categories: ["Education"],
  chapters: [{ start: 0, title: "Intro" }],
  language: "en",
};

describe("videoInfo", () => {
  it("reads the script's line once per id", async () => {
    const run = vi.fn(async function* () {
      yield RAW;
    });
    expect(await videoInfo("aaaaaaaaaaa", run)).toEqual(RAW);
    expect(await videoInfo("aaaaaaaaaaa", run)).toEqual(RAW);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is undefined when the script fails, and asks again next time", async () => {
    const run = vi.fn(async function* () {
      yield* [];
      throw new Error("no network");
    });
    expect(await videoInfo("bbbbbbbbbbb", run)).toBeUndefined();
    expect(await videoInfo("bbbbbbbbbbb", run)).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("isMusic", () => {
  it("is true for the Music category only", () => {
    expect(isMusic({ ...RAW, categories: ["Music"] })).toBe(true);
    expect(isMusic(RAW)).toBe(false);
  });
});
