import type { Api } from "grammy";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { saveState } from "./state.ts";
import {
  findVideo,
  newVideoDir,
  setMaking,
  summaryItems,
  syncSummaries,
  videoFolderName,
} from "./summary.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

async function video(
  root: string,
  id: string,
  title: string,
  at: number,
  levels: string[] = [],
) {
  const dir = join(root, `Channel - ${id}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ id, title, categories: [], chapters: [] }),
  );
  await writeFile(join(dir, "about.md"), "Про що.\n\nЩо каже.\n");
  await utimes(join(dir, "about.md"), at, at);
  for (const level of levels) await writeFile(join(dir, `${level}.md`), "x");
}

describe("video folders", () => {
  it("names a folder «Channel - Title», safe as a file name, like the karaoke songs", () => {
    expect(
      videoFolderName({
        title: "AI: the end?",
        channel: "Lex",
        categories: [],
        chapters: [],
      }),
    ).toBe("Lex - AI_ the end_");
    expect(
      videoFolderName({ title: "...Hidden.", categories: [], chapters: [] }),
    ).toBe("Hidden");
    expect(
      videoFolderName({
        title: "x".repeat(200),
        categories: [],
        chapters: [],
      }),
    ).toHaveLength(100);
  });

  it("makes a video's folder with its id in meta.json, and finds it by that id", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    const info = {
      title: "Talk",
      channel: "Lex",
      categories: [],
      chapters: [],
    };
    const dir = await newVideoDir("aaaaaaaaaaa", info, root);
    expect(dir).toBe(join(root, "Lex - Talk"));
    expect(await findVideo("aaaaaaaaaaa", root)).toEqual({
      dir,
      info: { id: "aaaaaaaaaaa", ...info },
    });
    expect(await findVideo("bbbbbbbbbbb", root)).toBeUndefined();
    // Another video with the same name gets its id after it.
    expect(await newVideoDir("bbbbbbbbbbb", info, root)).toBe(
      join(root, "Lex - Talk (bbbbbbbbbbb)"),
    );
  });
});

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
    const level = (id: string, l: string) => [
      `${id}/${l}/title`,
      `${id}/${l}`,
      `${id}/${l}/audio`,
    ];
    expect(items.map((i) => i.key)).toEqual([
      "contents",
      "aaaaaaaaaaa/about",
      ...level("aaaaaaaaaaa", "brief"),
      ...level("aaaaaaaaaaa", "detailed"),
      "bbbbbbbbbbb/about",
      ...level("bbbbbbbbbbb", "brief"),
      ...level("bbbbbbbbbbb", "detailed"),
    ]);
    const byKey = (key: string) => items.find((i) => i.key === key);
    expect(byKey("aaaaaaaaaaa/about")).toEqual({
      key: "aaaaaaaaaaa/about",
      kind: "text",
      text: "📝 <b>First</b>\nhttps://youtu.be/aaaaaaaaaaa\n\nПро що.\n\nЩо каже.",
      preview: "https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg",
    });
    expect(byKey("aaaaaaaaaaa/brief/title")).toEqual({
      key: "aaaaaaaaaaa/brief/title",
      kind: "text",
      text: "📋 <b>Brief summary</b>",
    });
    expect(byKey("aaaaaaaaaaa/brief")).toEqual({
      key: "aaaaaaaaaaa/brief",
      kind: "text",
      text: "No document yet",
      buttons: [{ text: "✨ Generate", data: "summary:brief:aaaaaaaaaaa" }],
    });
    expect(byKey("aaaaaaaaaaa/brief/audio")).toEqual({
      key: "aaaaaaaaaaa/brief/audio",
      kind: "text",
      text: "No audio yet",
      buttons: [
        { text: "🎙 Oksana", data: "summary:voice:brief:aaaaaaaaaaa:Oksana" },
        { text: "🎙 Andrii", data: "summary:voice:brief:aaaaaaaaaaa:Andrii" },
      ],
    });
    expect(byKey("aaaaaaaaaaa/detailed/title")).toMatchObject({
      text: "📖 <b>Detailed summary</b>",
    });
    const doc = byKey("bbbbbbbbbbb/brief");
    expect(doc).toMatchObject({
      kind: "document",
      file: join(root, "Channel - bbbbbbbbbbb", "brief.md"),
      name: "Second _ talk (стисло).md",
    });
    expect(doc).not.toHaveProperty("caption");
    expect(byKey("bbbbbbbbbbb/detailed")).toMatchObject({
      name: "Second _ talk (детально).md",
    });
  });

  it("puts the level's audio in its place once voiced, not while it is written", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "aaaaaaaaaaa", "First / talk", 1000, [
      "brief",
      "detailed",
    ]);
    const dir = join(root, "Channel - aaaaaaaaaaa");
    await writeFile(join(dir, "brief - Oksana.mp3"), "abc");
    await writeFile(join(dir, "detailed - Andrii.mp3.part"), "abc");
    const items = await summaryItems(root);
    const audio = items.find((i) => i.key === "aaaaaaaaaaa/brief/audio");
    expect(audio).toMatchObject({
      kind: "audio",
      file: join(dir, "brief - Oksana.mp3"),
      name: "First _ talk (стисло).mp3",
      title: "First / talk (стисло)",
      performer: "Oksana",
      size: 3,
    });
    expect(audio).not.toHaveProperty("caption");
    expect(
      items.find((i) => i.key === "aaaaaaaaaaa/detailed/audio"),
    ).toMatchObject({ kind: "text", text: "No audio yet" });
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

  it("shows a document or audio being made without buttons", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "aaaaaaaaaaa", "First", 1000);
    const at = async (key: string) =>
      (await summaryItems(root)).find((i) => i.key === key);
    setMaking("aaaaaaaaaaa/detailed", true);
    setMaking("aaaaaaaaaaa/detailed/audio", true);
    expect(await at("aaaaaaaaaaa/detailed")).toEqual({
      key: "aaaaaaaaaaa/detailed",
      kind: "text",
      text: "Generating document…",
    });
    expect(await at("aaaaaaaaaaa/detailed/audio")).toEqual({
      key: "aaaaaaaaaaa/detailed/audio",
      kind: "text",
      text: "Voicing audio…",
    });
    setMaking("aaaaaaaaaaa/detailed", false);
    setMaking("aaaaaaaaaaa/detailed/audio", false);
    expect(await at("aaaaaaaaaaa/detailed")).toHaveProperty("buttons");
    expect(await at("aaaaaaaaaaa/detailed/audio")).toHaveProperty("buttons");
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
    expect(api.createForumTopic).toHaveBeenCalledWith(-100, "Summary", {
      icon_custom_emoji_id: "5373251851074415873",
    });
    expect(synced?.changed).toEqual([
      "contents",
      "aaaaaaaaaaa/about",
      "aaaaaaaaaaa/brief/title",
      "aaaaaaaaaaa/brief",
      "aaaaaaaaaaa/brief/audio",
      "aaaaaaaaaaa/detailed/title",
      "aaaaaaaaaaa/detailed",
      "aaaaaaaaaaa/detailed/audio",
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
