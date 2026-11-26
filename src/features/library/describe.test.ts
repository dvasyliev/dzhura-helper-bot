import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = vi.hoisted(() => ({ dir: "" }));
vi.mock("../audiobook/text.ts", async (original) => ({
  ...(await original<typeof import("../audiobook/text.ts")>()),
  get BOOKS_DIR() {
    return root.dir;
  },
}));
vi.mock("../audiobook/library.ts", async () => {
  const names = ["000 Intro", "001 Sea"];
  return {
    shelf: async () => ["Book"],
    loadBook: async () => ({ title: "Book", chapters: [], folder: "Book" }),
    chapters: () =>
      names.map((name, index) => ({
        index,
        name,
        title: name,
        text: "слово ".repeat(100),
      })),
  };
});

import { describeShelf, describeText } from "./describe.ts";

const run = vi.fn(async () => "Опис.");

beforeEach(async () => {
  run.mockClear();
  root.dir = await mkdtemp(join(tmpdir(), "describe-shelf-"));
  await mkdir(join(root.dir, "Book", "audio", "Voice"), { recursive: true });
});

describe("describeText", () => {
  it("shows progress and the time left", () => {
    expect(describeText(3, 10, 5)).toBe(
      "📝 <b>Describing parts</b>\n3 of 10 · ≈5 min left",
    );
  });
});

describe("describeShelf", () => {
  it("describes only parts with voiced tracks, shows progress, and a second run calls nothing", async () => {
    await writeFile(
      join(root.dir, "Book", "audio", "Voice", "001 Sea.mp3"),
      "",
    );
    const shown: string[] = [];
    const show = async (text: string) => void shown.push(text);
    await describeShelf(show, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(shown[0]).toContain("0 of 1");
    expect(
      JSON.parse(await readFile(join(root.dir, "Book", "parts.json"), "utf8")),
    ).toEqual({
      "000 Intro|001 Sea": "Опис.",
    });
    await describeShelf(show, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(shown).toHaveLength(2); // the second run shows no status at all
  });

  it("shows nothing when no audio is voiced", async () => {
    const show = vi.fn(async () => {});
    await describeShelf(show, run);
    expect(show).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
