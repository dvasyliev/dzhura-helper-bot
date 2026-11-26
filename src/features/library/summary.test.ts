import type { Api } from "grammy";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { saveState } from "./state.ts";
import { summaryItems, syncSummaries } from "./summary.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

async function video(
  root: string,
  id: string,
  title: string,
  at: number,
  levels: string[] = [],
) {
  await mkdir(join(root, id), { recursive: true });
  await writeFile(
    join(root, id, "meta.json"),
    JSON.stringify({ title, categories: [], chapters: [] }),
  );
  await writeFile(join(root, id, "about.md"), "Про що.\n\nЩо каже.\n");
  await utimes(join(root, id, "about.md"), at, at);
  for (const level of levels)
    await writeFile(join(root, id, `${level}.md`), "x");
}

describe("summaryItems", () => {
  it("gives each video its description with buttons for the missing files, then its files, oldest first", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "bbbbbbbbbbb", "Second / talk", 2000, [
      "brief",
      "detailed",
    ]);
    await video(root, "aaaaaaaaaaa", "First", 1000, ["detailed"]);
    await mkdir(join(root, "ccccccccccc")); // not described yet
    const items = await summaryItems(root);
    expect(items.map((i) => i.key)).toEqual([
      "aaaaaaaaaaa/about",
      "aaaaaaaaaaa/detailed",
      "bbbbbbbbbbb/about",
      "bbbbbbbbbbb/brief",
      "bbbbbbbbbbb/detailed",
    ]);
    expect(items[0]).toEqual({
      key: "aaaaaaaaaaa/about",
      kind: "text",
      text: "📝 <b>First</b>\nhttps://youtu.be/aaaaaaaaaaa\n\nПро що.\n\nЩо каже.",
      buttons: [{ text: "📋 Стисло", data: "summary:brief:aaaaaaaaaaa" }],
    });
    expect(items[2]).not.toHaveProperty("buttons");
    expect(items[3]).toMatchObject({
      kind: "document",
      file: join(root, "bbbbbbbbbbb", "brief.md"),
      name: "Second _ talk (стисло).md",
    });
    expect(items[4]).toMatchObject({ name: "Second _ talk (детально).md" });
  });
});

describe("syncSummaries", () => {
  it("posts them in the «📝 Summary» topic", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-sync-"));
    const dirs = {
      summary: join(root, "summary"),
      state: join(root, "library.json"),
    };
    await video(dirs.summary, "aaaaaaaaaaa", "First", 1000, ["brief"]);
    await saveState({ chatId: -100, topics: {} }, dirs.state);
    let next = 1;
    const sent = async () => ({ message_id: next++ });
    const api = {
      createForumTopic: vi.fn(async () => ({ message_thread_id: 9 })),
      sendMessage: vi.fn(sent),
      sendDocument: vi.fn(async () => ({
        ...(await sent()),
        document: { file_id: "f" },
      })),
    };
    const synced = await syncSummaries(api as unknown as Api, dirs);
    expect(api.createForumTopic).toHaveBeenCalledWith(-100, "📝 Summary");
    expect(synced?.changed).toEqual(["aaaaaaaaaaa/about", "aaaaaaaaaaa/brief"]);
  });
});
