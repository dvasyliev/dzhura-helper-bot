import type { Api } from "grammy";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { saveState } from "./state.ts";
import {
  audioMenu,
  findVideo,
  newVideoDir,
  setMaking,
  showSummary,
  shownSummary,
  summaryItems,
  summaryMenu,
  syncSummaries,
  videoFolderName,
  videoLanguages,
} from "./summary.ts";

vi.mock("../telegram/owner.ts", () => ({ ownerId: () => 7 }));

async function video(
  root: string,
  id: string,
  title: string,
  at: number,
  levels: string[] = [],
  language?: string,
) {
  const dir = join(root, `Channel - ${id}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ id, title, categories: [], chapters: [], language }),
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
    // A plain file (Finder's .DS_Store) is not a video folder.
    await writeFile(join(root, ".DS_Store"), "");
    expect(await findVideo("aaaaaaaaaaa", root)).toEqual({
      dir,
      info: { id: "aaaaaaaaaaa", ...info },
    });
    // Another video with the same name gets its id after it.
    expect(await newVideoDir("bbbbbbbbbbb", info, root)).toBe(
      join(root, "Lex - Talk (bbbbbbbbbbb)"),
    );
  });
});

describe("summaryItems", () => {
  it("gives each video its card, then its summary and audio slots, oldest first", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "bbbbbbbbbbb", "Second / talk", 2000, ["detailed"]);
    await video(root, "aaaaaaaaaaa", "First", 1000);
    await mkdir(join(root, "ccccccccccc")); // not described yet
    const items = await summaryItems(root);
    expect(items.map((i) => i.key)).toEqual([
      "contents",
      "aaaaaaaaaaa/about",
      "aaaaaaaaaaa/summary",
      "aaaaaaaaaaa/audio",
      "bbbbbbbbbbb/about",
      "bbbbbbbbbbb/summary",
      "bbbbbbbbbbb/audio",
    ]);
    const byKey = (key: string) => items.find((i) => i.key === key);
    expect(byKey("aaaaaaaaaaa/about")).toEqual({
      key: "aaaaaaaaaaa/about",
      kind: "text",
      text: "📝 <b>First</b>\nhttps://youtu.be/aaaaaaaaaaa\n\nПро що.\n\nЩо каже.",
      preview: "https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg",
      buttons: [{ text: "📝 Summary", data: "summary:text:aaaaaaaaaaa" }],
    });
    expect(byKey("aaaaaaaaaaa/summary")).toEqual({
      key: "aaaaaaaaaaa/summary",
      kind: "text",
      text: "📝 Summary",
    });
    expect(byKey("aaaaaaaaaaa/audio")).toEqual({
      key: "aaaaaaaaaaa/audio",
      kind: "text",
      text: "🎧 Audio",
    });
    // Only the detailed summary is written: it is the one shown.
    expect(byKey("bbbbbbbbbbb/summary")).toEqual(
      expect.objectContaining({
        kind: "document",
        file: join(root, "Channel - bbbbbbbbbbb", "detailed.md"),
        name: "Detailed: Second _ talk.md",
        caption: "📝 <b>Detailed Summary (UA)</b>",
      }),
    );
    expect(byKey("bbbbbbbbbbb/about")).toHaveProperty("buttons", [
      { text: "📝 Summary", data: "summary:text:bbbbbbbbbbb" },
      { text: "🎧 Audio", data: "summary:audio:bbbbbbbbbbb" },
    ]);
  });

  it("shows the shown version and its audio, named after the video", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "aaaaaaaaaaa", "Talk", 1000, ["brief"], "en");
    const dir = join(root, "Channel - aaaaaaaaaaa");
    await writeFile(join(dir, "brief.en.md"), "en");
    await writeFile(join(dir, "brief - Heart.mp3"), "abc");
    await showSummary(dir, { level: "brief", language: "en", voice: "Heart" });
    const items = await summaryItems(root);
    expect(items.find((i) => i.key === "aaaaaaaaaaa/summary")).toMatchObject({
      file: join(dir, "brief.en.md"),
      name: "Brief (EN): Talk.md",
      caption: "📝 <b>Brief Summary (EN)</b>",
    });
    const audio = items.find((i) => i.key === "aaaaaaaaaaa/audio");
    expect(audio).toEqual({
      key: "aaaaaaaaaaa/audio",
      kind: "audio",
      file: join(dir, "brief - Heart.mp3"),
      name: "Brief (EN): Talk.mp3",
      title: "Brief (EN): Talk",
      performer: "Talk",
      caption: "🎧 <b>Brief Audio (EN)</b>",
      size: 3,
      mtime: expect.any(Number),
    });
  });

  it("falls back to the first version written, with its audio, without a shown.json of this shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "aaaaaaaaaaa", "Talk", 1000, ["detailed"], "en");
    const dir = join(root, "Channel - aaaaaaaaaaa");
    await writeFile(join(dir, "brief.en.md"), "en");
    await writeFile(join(dir, "brief - George.mp3"), "a");
    await writeFile(
      join(dir, "shown.json"),
      JSON.stringify({ brief: { language: "en", voices: {} } }),
    );
    const info = { language: "en" };
    expect(await shownSummary(dir, info)).toEqual({
      level: "brief",
      language: "en",
      voice: "George",
    });
    // A saved version whose text is gone is not shown.
    await showSummary(dir, { level: "brief", language: "uk" });
    expect((await shownSummary(dir, info))?.language).toBe("en");
    expect(await shownSummary(dir, { language: "uk" })).toEqual({
      level: "detailed",
      language: "uk",
    });
  });

  it("menus the versions but the shown one, a row a level", () => {
    const texts = (rows: { text: string }[][]) =>
      rows.map((row) => row.map((b) => b.text));
    const both = summaryMenu("aaaaaaaaaaa", ["uk", "en"], {
      level: "brief",
      language: "en",
    });
    expect(texts(both)).toEqual([
      ["Brief (UA)"],
      ["Detailed (UA)", "Detailed (EN)"],
      ["← Back"],
    ]);
    expect(both[0]![0]!.data).toBe("summary:pick:aaaaaaaaaaa:brief:uk");
    expect(both.at(-1)![0]!.data).toBe("summary:back:aaaaaaaaaaa");
    expect(texts(summaryMenu("aaaaaaaaaaa", ["uk"]))).toEqual([
      ["Brief", "Detailed"],
      ["← Back"],
    ]);
  });

  it("menus the voices of the shown language as a woman and a man, but the one playing", () => {
    expect(
      audioMenu("aaaaaaaaaaa", {
        level: "brief",
        language: "uk",
        voice: "Oksana",
      }),
    ).toEqual([
      [{ text: "👨 Man (UA)", data: "summary:voice:aaaaaaaaaaa:Andrii" }],
      [{ text: "← Back", data: "summary:back:aaaaaaaaaaa" }],
    ]);
    expect(
      audioMenu("aaaaaaaaaaa", { level: "brief", language: "en" })[0]!.map(
        (b) => b.text,
      ),
    ).toEqual(["👩 Woman (EN)", "👨 Man (EN)"]);
    expect(videoLanguages({ language: "en-US" })).toEqual(["uk", "en"]);
    expect(videoLanguages({})).toEqual(["uk"]);
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

  it("shows ⏳ on a slot being made", async () => {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await video(root, "aaaaaaaaaaa", "First", 1000, ["brief"]);
    const at = async (key: string) =>
      (await summaryItems(root)).find((i) => i.key === key);
    setMaking("aaaaaaaaaaa/summary", true, "Detailed Summary (UA)");
    setMaking("aaaaaaaaaaa/audio", true, "Detailed Audio (UA)");
    expect(await at("aaaaaaaaaaa/summary")).toHaveProperty(
      "caption",
      "<b>⏳ Processing: Detailed Summary (UA)</b>",
    );
    expect(await at("aaaaaaaaaaa/audio")).toHaveProperty(
      "text",
      "<b>⏳ Processing: Detailed Audio (UA)</b>",
    );
    setMaking("aaaaaaaaaaa/summary", false);
    setMaking("aaaaaaaaaaa/audio", false);
    expect(await at("aaaaaaaaaaa/audio")).toHaveProperty("text", "🎧 Audio");
  });
});

/** A temp folder's summary root and library state file. */
async function syncDirs() {
  const root = await mkdtemp(join(tmpdir(), "summary-sync-"));
  return { summary: join(root, "summary"), state: join(root, "library.json") };
}

describe("syncSummaries", () => {
  it("moves the brief messages into the slots and deletes the detailed ones, keeping every other message in place", async () => {
    const dirs = await syncDirs();
    await video(dirs.summary, "aaaaaaaaaaa", "First", 1000);
    const keys = [
      "contents",
      "aaaaaaaaaaa/about",
      "aaaaaaaaaaa/brief/title",
      "aaaaaaaaaaa/brief",
      "aaaaaaaaaaa/brief/audio",
      "aaaaaaaaaaa/detailed/title",
      "aaaaaaaaaaa/detailed",
      "aaaaaaaaaaa/detailed/audio",
    ];
    await saveState(
      {
        chatId: -100,
        topics: {
          summary: {
            threadId: 9,
            messages: keys.map((key, i) => ({
              key,
              messageId: i + 1,
              kind: "text" as const,
              version: "old",
            })),
            tooBig: {},
          },
        },
      },
      dirs.state,
    );
    const api = {
      editForumTopic: vi.fn(async () => true),
      editMessageText: vi.fn(async () => true),
      deleteMessage: vi.fn(async () => true),
      sendMessage: vi.fn(async () => ({ message_id: 99 })),
    };
    await syncSummaries(api as unknown as Api, dirs);
    expect(api.deleteMessage.mock.calls).toEqual([
      [-100, 3],
      [-100, 6],
      [-100, 7],
      [-100, 8],
    ]);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("posts them in the «📝 Summary» topic", async () => {
    const dirs = await syncDirs();
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
      "aaaaaaaaaaa/summary",
      "aaaaaaaaaaa/audio",
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
