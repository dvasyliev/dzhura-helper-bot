import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { folders, shelf } from "./shelf.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "folders-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("folders", () => {
  it("lists folders sorted, without files and hidden folders", async () => {
    await mkdir(path.join(root, "B"));
    await mkdir(path.join(root, "A"));
    await mkdir(path.join(root, ".incoming"));
    await writeFile(path.join(root, "note.txt"), "x");
    expect(await folders(root)).toEqual(["A", "B"]);
  });

  it("is empty for a missing root", async () => {
    expect(await folders(path.join(root, "none"))).toEqual([]);
  });
});

describe("shelf", () => {
  it("adds a translation folder only when it has book.md", async () => {
    await mkdir(path.join(root, "Done/translation"), { recursive: true });
    await writeFile(path.join(root, "Done/translation/book.md"), "# T");
    await mkdir(path.join(root, "Partial/translation"), { recursive: true });
    await mkdir(path.join(root, "Plain"));
    expect(await shelf(root)).toEqual([
      "Done",
      "Done/translation",
      "Partial",
      "Plain",
    ]);
  });
});
