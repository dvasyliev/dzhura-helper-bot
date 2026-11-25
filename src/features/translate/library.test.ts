import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doneCount, unfinishedTranslations } from "./library.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "translate-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function book(name: string, files: string[]) {
  await mkdir(path.join(root, name, "chunks"), { recursive: true });
  for (const file of files) await writeFile(path.join(root, name, file), "");
}

describe("unfinishedTranslations", () => {
  it("lists folders without book.uk.md", async () => {
    await book("B - Second", ["book.md"]);
    await book("A - First", ["book.md", "book.uk.md"]);
    await book("C - Third", ["book.md", "glossary.json"]);
    await writeFile(path.join(root, "stray.txt"), "");
    expect(await unfinishedTranslations(root)).toEqual([
      "B - Second",
      "C - Third",
    ]);
  });

  it("is empty when the folder does not exist", async () => {
    expect(await unfinishedTranslations(path.join(root, "none"))).toEqual([]);
  });
});

describe("doneCount", () => {
  it("counts translated chunks", async () => {
    await book("A", [
      "chunks/0001.md",
      "chunks/0001.uk.md",
      "chunks/0002.md",
      "chunks/0002.uk.md",
      "chunks/0003.md",
    ]);
    expect(await doneCount(path.join(root, "A"))).toBe(2);
    expect(await doneCount(path.join(root, "none"))).toBe(0);
  });
});
