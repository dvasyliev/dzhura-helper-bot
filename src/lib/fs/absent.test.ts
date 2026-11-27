import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readdirEntriesOrEmpty,
  readdirOrEmpty,
  readFileOrUndefined,
  statOrUndefined,
} from "./absent.ts";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "absent-"));
  file = path.join(dir, "plain.txt");
  await writeFile(file, "hello");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("a missing path (ENOENT)", () => {
  it("is empty or undefined", async () => {
    const missing = path.join(dir, "nope");
    expect(await readdirOrEmpty(missing)).toEqual([]);
    expect(await readdirEntriesOrEmpty(missing)).toEqual([]);
    expect(await statOrUndefined(missing)).toBeUndefined();
    expect(await readFileOrUndefined(missing)).toBeUndefined();
  });
});

describe("an existing path", () => {
  it("is read", async () => {
    expect(await readdirOrEmpty(dir)).toEqual(["plain.txt"]);
    expect((await readdirEntriesOrEmpty(dir))[0]?.name).toBe("plain.txt");
    expect((await statOrUndefined(file))?.size).toBe(5);
    expect(await readFileOrUndefined(file)).toBe("hello");
  });
});

describe("another error (ENOTDIR: a file where a folder is expected)", () => {
  it("is thrown, not read as absent", async () => {
    const below = path.join(file, "child");
    await expect(readdirOrEmpty(below)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
    await expect(readdirEntriesOrEmpty(below)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
    await expect(statOrUndefined(below)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
    await expect(readFileOrUndefined(below)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });
});
