import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeSource, readPdf } from "./pdf.ts";

vi.mock("../python/python.ts", () => ({
  // oxlint-disable-next-line require-yield
  runPython: async function* () {
    throw new Error("pdf_convert exited with code 1");
  },
}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pdf-test-"));
});

async function touch(...files: string[]) {
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), "x");
  }
}

describe("placeSource", () => {
  it("keeps the sent files, deletes other sources, keeps text/ and audio/", async () => {
    await touch(
      "old.epub",
      "old.pdf",
      "book.md",
      "new.pdf",
      "text/001.txt",
      "audio/Heart/001.mp3",
    );
    await placeSource(dir, ["new.pdf", "book.md"]);
    expect((await readdir(dir)).sort()).toEqual([
      "audio",
      "book.md",
      "new.pdf",
      "text",
    ]);
  });

  it("for an EPUB deletes book.md and the PDF", async () => {
    await touch("new.epub", "book.md", "a.pdf");
    await placeSource(dir, ["new.epub"]);
    expect(await readdir(dir)).toEqual(["new.epub"]);
  });
});

describe("readPdf", () => {
  it("cleans the incoming folder when the script fails", async () => {
    await expect(readPdf(Buffer.from("x"), "a.pdf", dir)).rejects.toThrow(
      "exited with code 1",
    );
    expect(await readdir(dir)).toEqual([]);
  });
});
