import { afterEach, describe, expect, it, vi } from "vitest";
import { runPython } from "./python.ts";

describe("runPython", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([false, true])(
    "rejects, without an unhandled error, when uv is missing (background: %s)",
    async (background) => {
      vi.stubEnv("PATH", "/nonexistent");
      const read = async () => {
        for await (const _line of runPython("script.py", {}, { background })) {
          // no output expected
        }
      };
      await expect(read()).rejects.toThrow(/ENOENT/);
    },
  );
});
