import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { folderKey } from "../translate/button.ts";
import { canMakeEpub, epubActions } from "./index.ts";

async function folder(files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "epub-"));
  await mkdir(join(root, "A - T"));
  for (const file of files) await writeFile(join(root, "A - T", file), "");
  return root;
}

describe("canMakeEpub", () => {
  it("is true for a PDF read into book.md with no EPUB yet", async () => {
    expect(await canMakeEpub("A - T", await folder(["t.pdf", "book.md"]))).toBe(
      true,
    );
  });

  it("is false once the EPUB is made, for an EPUB book, and for a missing folder", async () => {
    expect(
      await canMakeEpub(
        "A - T",
        await folder(["t.pdf", "book.md", "book.epub"]),
      ),
    ).toBe(false);
    expect(await canMakeEpub("A - T", await folder(["t.epub"]))).toBe(false);
    expect(await canMakeEpub("Missing", await folder([]))).toBe(false);
  });
});

describe("epubActions", () => {
  const input = {
    kind: "book" as const,
    folder: "A - T",
    book: { title: "T", author: "A", chapters: [{ title: "1", text: "x" }] },
  };

  it("offers «📘 Make EPUB» for a PDF book without an EPUB", async () => {
    const root = await folder(["t.pdf", "book.md"]);
    expect(await epubActions(input, root)).toEqual({
      buttons: [{ text: "📘 Make EPUB", data: `epub:${folderKey("A - T")}` }],
    });
  });

  it("offers nothing for an EPUB book or a link", async () => {
    const root = await folder(["t.epub"]);
    expect(await epubActions(input, root)).toBeUndefined();
    expect(
      await epubActions({ kind: "link", url: "https://a.b" }, root),
    ).toBeUndefined();
  });
});
