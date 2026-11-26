import type { Api } from "grammy";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { saveState } from "./state.ts";
import { setMaking, summaryItems, syncSummaries } from "./summary.ts";

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
  it("gives each video its description, then each level's file or a placeholder to make it, oldest first", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "bbbbbbbbbbb", "Second / talk", 2000, [
      "brief",
      "detailed",
    ]);
    await video(root, "aaaaaaaaaaa", "First", 1000, ["detailed"]);
    await mkdir(join(root, "ccccccccccc")); // not described yet
    const items = await summaryItems(root);
    expect(items.map((i) => i.key)).toEqual([
      "contents",
      "aaaaaaaaaaa/about",
      "aaaaaaaaaaa/brief",
      "aaaaaaaaaaa/detailed",
      "bbbbbbbbbbb/about",
      "bbbbbbbbbbb/brief",
      "bbbbbbbbbbb/detailed",
    ]);
    expect(items[1]).toEqual({
      key: "aaaaaaaaaaa/about",
      kind: "text",
      text: "📝 <b>First</b>\nhttps://youtu.be/aaaaaaaaaaa\n\nПро що.\n\nЩо каже.",
      preview: "https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg",
    });
    expect(items[2]).toEqual({
      key: "aaaaaaaaaaa/brief",
      kind: "text",
      text: "📋 <b>Brief summary</b>",
      buttons: [{ text: "Make it", data: "summary:brief:aaaaaaaaaaa" }],
    });
    expect(items[3]).toMatchObject({
      kind: "document",
      caption: "📖 <b>Detailed summary</b>",
    });
    expect(items[5]).toMatchObject({
      kind: "document",
      file: join(root, "bbbbbbbbbbb", "brief.md"),
      name: "Second _ talk (стисло).md",
      caption: "📋 <b>Brief summary</b>",
    });
    expect(items[6]).toMatchObject({ name: "Second _ talk (детально).md" });
  });

  it("starts with a pinned contents: each video's title, a link to its description once posted", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "bbbbbbbbbbb", "Second <talk>", 2000);
    await video(root, "aaaaaaaaaaa", "First", 1000);
    const link = (key: string) =>
      key === "aaaaaaaaaaa/about" ? "https://t.me/c/1/9/10" : undefined;
    expect((await summaryItems(root, link))[0]).toEqual({
      key: "contents",
      kind: "text",
      text: '📝 <b>Summary</b> · 2 videos\n\n• <a href="https://t.me/c/1/9/10">First</a>\n• Second &lt;talk&gt;',
      pin: true,
    });
  });

  it("keeps the contents within Telegram's limit, the newest titles first to stay", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    for (let i = 0; i < 90; i++)
      await video(
        root,
        `v${String(i).padStart(10, "0")}`,
        `${i} ${"x".repeat(60)}`,
        1000 + i,
      );
    const { text } = (await summaryItems(root))[0] as { text: string };
    expect(text.replace(/<[^>]+>/g, "").length).toBeLessThanOrEqual(4096);
    expect(text).toContain("89 x");
    expect(text).not.toContain("• 0 x");
  });

  it("shows a level being made with a clock and no button", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "aaaaaaaaaaa", "First", 1000);
    setMaking("aaaaaaaaaaa/detailed", true);
    const making = (await summaryItems(root))[3];
    setMaking("aaaaaaaaaaa/detailed", false);
    expect(making).toEqual({
      key: "aaaaaaaaaaa/detailed",
      kind: "text",
      text: "⏳ <b>Detailed summary</b>",
    });
    expect((await summaryItems(root))[3]).toHaveProperty("buttons");
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
      pinChatMessage: vi.fn(async () => true),
      editMessageText: vi.fn(async () => true),
      sendDocument: vi.fn(async () => ({
        ...(await sent()),
        document: { file_id: "f" },
      })),
    };
    const synced = await syncSummaries(api as unknown as Api, dirs);
    expect(api.createForumTopic).toHaveBeenCalledWith(-100, "📝 Summary");
    expect(synced?.changed).toEqual([
      "contents",
      "aaaaaaaaaaa/about",
      "aaaaaaaaaaa/brief",
      "aaaaaaaaaaa/detailed",
    ]);
    // A second pass links the description in the contents.
    expect(api.editMessageText).toHaveBeenCalledWith(
      -100,
      1,
      expect.stringContaining('/9/2">First</a>'),
      expect.anything(),
    );
  });
});
