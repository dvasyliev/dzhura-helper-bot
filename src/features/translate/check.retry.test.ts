import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPython } from "../../lib/python/python.ts";
import { checkChunk } from "./check.ts";

vi.mock("../../lib/python/python.ts", () => ({ runPython: vi.fn() }));

const input = {
  source: "One.",
  translation: "Раз.",
  terms: [],
  first: false,
  language: "uk",
};
const crash = () => ({
  [Symbol.asyncIterator]: () => ({
    next: () => Promise.reject(new Error("chunk_check exited with code 1")),
  }),
});
const reply = { translation: "Раз.", problems: [] };

beforeEach(() => vi.mocked(runPython).mockReset());

describe("checkChunk retries", () => {
  it("retries a crashed checker once", async () => {
    vi.mocked(runPython)
      .mockImplementationOnce(crash as never)
      .mockImplementationOnce(async function* () {
        yield reply;
      });
    expect(await checkChunk(input, { retryMs: 1 })).toEqual(reply);
    expect(runPython).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second crash", async () => {
    vi.mocked(runPython).mockImplementation(crash as never);
    await expect(checkChunk(input, { retryMs: 1 })).rejects.toThrow(/code 1/);
    expect(runPython).toHaveBeenCalledTimes(2);
  });
});
