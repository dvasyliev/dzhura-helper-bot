import { beforeEach, describe, expect, it, vi } from "vitest";
import { missingFor, missingTools } from "./tools.ts";

/** What each command prints; a command absent here is not installed. */
const installed = vi.hoisted(() => new Map<string, string>());
vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    _args: string[],
    _options: unknown,
    done: (error: Error | null, out?: { stdout: string }) => void,
  ) => {
    const stdout = installed.get(command);
    if (stdout === undefined) done(new Error(`spawn ${command} ENOENT`));
    else done(null, { stdout });
  },
}));

const WITH_ASS =
  " ... ass               V->V       Render ASS subtitles onto input video using the libass library.\n";

beforeEach(() => installed.clear());

describe("missingTools", () => {
  it("is empty when everything is installed and ffmpeg has libass", async () => {
    installed
      .set("ffmpeg", WITH_ASS)
      .set("pandoc", "pandoc 3")
      .set("claude", "2.0");
    expect(await missingTools()).toEqual(new Set());
  });

  it("names libass for an ffmpeg without it", async () => {
    installed
      .set("ffmpeg", " ... scale  V->V\n")
      .set("pandoc", "")
      .set("claude", "");
    expect(await missingTools()).toEqual(new Set(["libass"]));
  });

  it("names ffmpeg and libass when there is no ffmpeg, and every other missing tool", async () => {
    expect(await missingTools()).toEqual(
      new Set(["ffmpeg", "libass", "pandoc", "claude"]),
    );
  });
});

describe("missingFor", () => {
  it("keeps only the tools the feature needs, each with how to install it", () => {
    const missing = new Set(["ffmpeg", "libass", "pandoc"] as const);
    expect(missingFor(["pandoc", "claude"], missing)).toEqual([
      { tool: "pandoc", install: "brew install pandoc" },
    ]);
    expect(missingFor(undefined, missing)).toEqual([]);
  });
});
