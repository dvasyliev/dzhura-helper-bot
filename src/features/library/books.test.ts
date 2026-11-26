import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Api } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookFolders,
  bookItems,
  chapterFiles,
  syncBook,
  topicName,
  translations,
} from "./books.ts";
import { resetUnavailable } from "./group.ts";
import { saveState } from "./state.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

const ENGLISH = "The man and the dog went to the sea with his friend.";
const UKRAINIAN = "Чоловік і пес пішли до моря зі своїм другом.";

let root: string;
let dirs: { books: string; translate: string; state: string };

async function put(file: string, text = ""): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

function markdown(
  title: string,
  author: string,
  chapters: string[],
  text: string,
) {
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `author: ${JSON.stringify(author)}`,
    "---",
    "",
    ...chapters.flatMap((c) => [`# ${c}`, "", text, ""]),
  ].join("\n");
}

/** An English original «A — Orig» voiced by Kokoro, translated to «А — Ориг», voiced by Holos. */
async function translatedBook(): Promise<void> {
  await put(
    "books/Orig/book.md",
    markdown("Orig", "A", ["One", "Two"], ENGLISH),
  );
  await put("books/Orig/orig.epub");
  await put("books/Orig/audio/Kokoro/001 One.mp3");
  await put("books/Orig/audio/Kokoro/002 Two.mp3");
  const uk = markdown("Ориг", "А", ["Один", "Два"], UKRAINIAN);
  await put(
    "translate/Orig/book.md",
    markdown("Orig", "A", ["One", "Two"], ENGLISH),
  );
  await put("translate/Orig/book.uk.md", uk);
  await put("translate/Orig/book.uk.epub");
  await put("books/А - Ориг/book.md", uk);
  await put("books/А - Ориг/audio/Holos/001 Один.mp3");
}

function fakeApi() {
  let n = 100;
  const sent = () => Promise.resolve({ message_id: n++ });
  const file = (field: string) => () =>
    Promise.resolve({ message_id: n++, [field]: { file_id: `f${n}` } });
  return {
    createForumTopic: vi.fn(() => Promise.resolve({ message_thread_id: 5 })),
    sendMessage: vi.fn(sent),
    sendAudio: vi.fn(file("audio")),
    sendDocument: vi.fn(file("document")),
    pinChatMessage: vi.fn(() => Promise.resolve(true)),
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "books-"));
  dirs = {
    books: join(root, "books"),
    translate: join(root, "translate"),
    state: join(root, "library.json"),
  };
  resetUnavailable();
});

describe("chapterFiles", () => {
  it("keeps whole chapters in reading order", () => {
    expect(
      chapterFiles([
        "002 B.mp3",
        "001 A (2).mp3",
        "001 A (1).mp3",
        "003 C (2).mp3",
        "004 D.mp3.part",
      ]),
    ).toEqual(["001 A (1).mp3", "001 A (2).mp3", "002 B.mp3"]);
  });
});

describe("topicName", () => {
  it("puts the author before the title", () => {
    expect(topicName({ title: "T", author: "A" })).toBe("A — T");
  });

  it("cuts a long title to 128 characters", () => {
    expect(topicName({ title: "x".repeat(200) })).toHaveLength(128);
  });

  it("never cuts an emoji in half", () => {
    expect(topicName({ title: `${"x".repeat(127)}👍🏽` })).toBe("x".repeat(127));
  });
});

describe("bookItems", () => {
  it("puts contents, original, Ukrainian EPUB, then each voice's chapters", async () => {
    await translatedBook();
    const items = await bookItems("Orig", dirs);
    expect(items.map((i) => i.key)).toEqual([
      "contents",
      "original",
      "uk-epub",
      "voice:Kokoro",
      "voice:Kokoro/001 One.mp3",
      "voice:Kokoro/002 Two.mp3",
      "voice:Holos",
      "voice:Holos/001 Один.mp3",
    ]);
    expect(items[0]).toMatchObject({
      kind: "text",
      pin: true,
      text: [
        "📕 Orig",
        "A",
        "English · 2 chapters",
        "🎧 Kokoro: 2 of 2",
        "🎧 Holos: 1 of 2",
        "🌐 Ukrainian translation",
      ].join("\n"),
    });
    expect(items[2]).toMatchObject({ kind: "document", name: "А - Ориг.epub" });
    expect(items[5]).toMatchObject({
      kind: "audio",
      title: "002 Two",
      performer: "Orig",
    });
  });
});

describe("translations", () => {
  it("map the Ukrainian folder to its original", async () => {
    await translatedBook();
    expect(await translations(dirs)).toEqual(new Map([["А - Ориг", "Orig"]]));
  });
});

describe("bookFolders", () => {
  it("skips translations and adds translate folders with no audiobook folder", async () => {
    await translatedBook();
    await put(
      "translate/Other/book.md",
      markdown("Other", "B", ["X"], ENGLISH),
    );
    expect((await bookFolders(dirs)).sort()).toEqual(["Orig", "Other"]);
  });
});

describe("syncBook", () => {
  it("syncs the original's topic for a translation", async () => {
    await translatedBook();
    await saveState({ chatId: -100, topics: {} }, dirs.state);
    const api = fakeApi();
    const synced = await syncBook(api as unknown as Api, "А - Ориг", dirs);
    expect(api.createForumTopic).toHaveBeenCalledTimes(1);
    expect(api.createForumTopic).toHaveBeenCalledWith(-100, "A — Orig");
    expect(synced?.changed).toContain("voice:Holos/001 Один.mp3");
  });

  it("returns undefined without a group and calls nothing", async () => {
    await translatedBook();
    const api = fakeApi();
    expect(await syncBook(api as unknown as Api, "Orig", dirs)).toBeUndefined();
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("touches nothing for a folder with no book", async () => {
    await saveState({ chatId: -100, topics: {} }, dirs.state);
    const api = fakeApi();
    const synced = await syncBook(api as unknown as Api, "Missing", dirs);
    expect(synced?.changed).toEqual([]);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});
