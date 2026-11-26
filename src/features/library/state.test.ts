import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadState, saveState, serial, type LibraryState } from "./state.js";

async function tempFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "library-")), "library.json");
}

describe("library state", () => {
  it("missing file is an empty library", async () => {
    expect(await loadState(await tempFile())).toEqual({ topics: {} });
  });

  it("keeps the last group's id", async () => {
    const file = await tempFile();
    await saveState({ lastChatId: -100, topics: {} }, file);
    expect(await loadState(file)).toEqual({ lastChatId: -100, topics: {} });
  });

  it("saves and loads back", async () => {
    const file = await tempFile();
    const state: LibraryState = {
      chatId: -100,
      topics: {
        book: {
          threadId: 5,
          messages: [{ key: "a", messageId: 1, kind: "text", version: "v1" }],
          tooBig: { b: "v2" },
        },
      },
    };
    await saveState(state, file);
    expect(await loadState(file)).toEqual(state);
  });

  it("rejects a broken file", async () => {
    const bad = await tempFile();
    await writeFile(bad, '{"topics": 3}');
    await expect(loadState(bad)).rejects.toThrow("library.json");
  });

  it("serial runs one at a time", async () => {
    const log: string[] = [];
    let release = (): void => {};
    const first = serial(async () => {
      log.push("first start");
      await new Promise<void>((r) => (release = r));
      log.push("first end");
    });
    const second = serial(async () => {
      log.push("second start");
    });
    await Promise.resolve();
    expect(log).toEqual(["first start"]);
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(["first start", "first end", "second start"]);
  });
});
