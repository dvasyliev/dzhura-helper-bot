import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readJsonOrUndefined } from "./json.ts";

const SCHEMA = z.object({ id: z.string() });
let dir: string;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "json-"));
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  log.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

describe("readJsonOrUndefined", () => {
  it("reads a valid file", async () => {
    const file = path.join(dir, "a.json");
    await writeFile(file, '{"id":"x"}');
    expect(await readJsonOrUndefined(file, SCHEMA)).toEqual({ id: "x" });
    expect(log).not.toHaveBeenCalled();
  });

  it("is quiet about a missing file", async () => {
    expect(
      await readJsonOrUndefined(path.join(dir, "none.json"), SCHEMA),
    ).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a file with bad JSON or the wrong shape", async () => {
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, "{oops");
    expect(await readJsonOrUndefined(bad, SCHEMA)).toBeUndefined();
    const wrong = path.join(dir, "wrong.json");
    await writeFile(wrong, '{"id":1}');
    expect(await readJsonOrUndefined(wrong, SCHEMA)).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain(bad);
  });
});
