import { afterEach, describe, expect, it, vi } from "vitest";
import { runPython } from "./python.ts";

describe("runPython", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects, without an unhandled error, when uv is missing", async () => {
    vi.stubEnv("PATH", "/nonexistent");
    const read = async () => {
      for await (const _line of runPython("script.py", {})) {
        // no output expected
      }
    };
    await expect(read()).rejects.toThrow(/ENOENT/);
  });
});
