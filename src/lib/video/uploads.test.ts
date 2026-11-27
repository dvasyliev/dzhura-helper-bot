import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStore, uploads } from "./uploads.ts";

function storeWith(content: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "store-")), "y.json");
  writeFileSync(file, content);
  return file;
}

describe("the YouTube store", () => {
  it("is empty when the file is missing", () => {
    expect(readStore("/nonexistent/youtube.json")).toEqual({ videos: {} });
  });

  it("reads the token and the uploads", () => {
    const file = storeWith('{"refreshToken":"r","videos":{"A":"id1"}}');
    expect(readStore(file)).toEqual({
      refreshToken: "r",
      videos: { A: "id1" },
    });
    expect(uploads(file)).toEqual({ A: "id1" });
  });

  it("reports a store of the wrong shape, naming the file", () => {
    const file = storeWith('{"videos":{"A":5}}');
    expect(() => readStore(file)).toThrow(
      new RegExp(`^${file} is not a YouTube store`),
    );
    expect(() => uploads(file)).toThrow(/is not a YouTube store/);
  });
});
