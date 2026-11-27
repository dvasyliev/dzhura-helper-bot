import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryLoadBook } from "./shelf.ts";

let root: string;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "shelf-"));
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  log.mockRestore();
  await rm(root, { recursive: true, force: true });
});

describe("tryLoadBook", () => {
  it("is quiet about a missing folder", async () => {
    expect(await tryLoadBook("none", root)).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a folder that cannot be read", async () => {
    await writeFile(path.join(root, "file"), "not a folder");
    expect(await tryLoadBook("file", root)).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "Book file unreadable:",
      expect.objectContaining({ code: "ENOTDIR" }),
    );
  });

  it("is undefined, quietly, for a folder with no book", async () => {
    expect(await tryLoadBook(".", root)).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });
});
