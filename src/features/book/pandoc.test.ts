import { execFileSync } from "node:child_process";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEpub } from "./pandoc.ts";

function hasPandoc(): boolean {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasPandoc())("buildEpub", () => {
  it("builds an EPUB from book.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pandoc-"));
    const md = join(dir, "book.md");
    await writeFile(
      md,
      '---\ntitle: "T"\nauthor: "A"\n---\n\n# One\n\nText.\n',
    );
    const epub = join(dir, "book.epub");
    expect(await buildEpub(md, epub, { lang: "en" })).toBe(true);
    expect((await stat(epub)).size).toBeGreaterThan(0);
  });
});
