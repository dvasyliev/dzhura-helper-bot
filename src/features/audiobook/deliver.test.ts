import type { Api } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncBook } from "../../lib/library/books.ts";
import type { Synced } from "../../lib/library/topic/topic.ts";
import { voiceBook } from "./deliver.ts";
import {
  voiceChapters,
  type Voice,
  type VoiceEvent,
} from "../../lib/tts/voice.ts";

vi.mock("../../lib/tts/voice.ts", () => ({ voiceChapters: vi.fn() }));
/** The book's tracks, as `chapters(book)` returns them; each test sets its own. */
const tracks = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../lib/book/tracks.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/book/tracks.ts")>()),
  chapters: () => tracks.list,
}));
vi.mock("../../lib/library/books.ts", () => ({ syncBook: vi.fn() }));

const book = {
  title: "Book",
  author: "Author",
  chapters: [],
  folder: "Author - Book",
};
const voice: Voice = {
  id: "v",
  name: "Voice",
  provider: "holos",
  language: "uk",
} as Voice;
const todo = [
  { index: 0, name: "001 One", text: "one", title: "One" },
  { index: 1, name: "002 Two", text: "two", title: "Two" },
];

/** Chapters 001…`n`, each voiced into one file. */
function many(n: number) {
  const chapters = Array.from({ length: n }, (_, i) => ({
    index: i,
    name: String(i + 1).padStart(3, "0"),
    text: "x",
    title: `Chapter: ${i + 1}`,
  }));
  tracks.list = chapters;
  events(
    chapters.map((c) => ({ chapter: c.index, files: [`/a/${c.name}.mp3`] })),
  );
  return chapters;
}
const folder = "Author - Book";

function fakeApi() {
  return {
    sendAudio: vi.fn(async () => ({})),
    sendMediaGroup: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({})),
    sendDocument: vi.fn(async () => ({})),
    editMessageText: vi.fn(async () => ({})),
  };
}

function events(list: VoiceEvent[]) {
  vi.mocked(voiceChapters).mockImplementation(async function* () {
    yield* list;
  });
}

const chapterEvents: VoiceEvent[] = [
  { chapter: 0, files: ["/a/001 One.mp3"] },
  { chapter: 1, files: ["/a/002 Two.mp3"] },
];

/** Chapters 1 and 2 voiced, chapter 3 fails. */
function failingThird() {
  events([
    { chapter: 0, files: ["/a/001 One.mp3"] },
    { chapter: 1, files: ["/a/002 Two.mp3"] },
    { chapter: 2, error: "boom" },
  ]);
  tracks.list = [
    ...todo,
    { index: 2, name: "003 Three", text: "x", title: "Three" },
  ];
  return tracks.list as typeof todo;
}

function synced(changed: string[]): Synced {
  return { changed, link: (key) => `https://t.me/c/1/2/${key}` };
}

beforeEach(() => {
  tracks.list = todo;
  vi.mocked(syncBook).mockReset();
});

describe("voiceBook", () => {
  it("sends each chapter once it is voiced; Done once", async () => {
    const chapters = many(12);
    const api = fakeApi();
    vi.mocked(syncBook).mockResolvedValue(synced([]));
    vi.mocked(syncBook).mockResolvedValueOnce(
      synced(["contents", "voice:Voice", "voice:Voice/001.mp3"]),
    );
    api.sendMessage.mockResolvedValueOnce({ message_id: 9 });
    await voiceBook(api as unknown as Api, 5, book, voice, chapters, "new", {
      done: 0,
      total: 12,
    });
    expect(syncBook).toHaveBeenCalledTimes(12);
    expect(syncBook).toHaveBeenCalledWith(api, folder);
    expect(api.sendAudio).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      5,
      '<b>✅ Done: Audiobook (UA)</b> - <a href="https://t.me/c/1/2/voice:Voice/001.mp3">Book</a>',
      { parse_mode: "HTML" },
    );
  });

  it("without a group sends each audio with its title and caption", async () => {
    vi.mocked(syncBook).mockResolvedValue(undefined);
    for (const mode of ["new", "regen"] as const) {
      const chapters = many(3);
      const api = fakeApi();
      await voiceBook(api as unknown as Api, 5, book, voice, chapters, mode);
      // Each audio on its own, titled by its chapter.
      expect(api.sendMediaGroup).not.toHaveBeenCalled();
      expect(
        (
          api.sendAudio.mock.calls as unknown as [
            number,
            unknown,
            { title: string; caption: string },
          ][]
        ).map((c) => [c[2].title, c[2].caption]),
      ).toEqual([
        ["001. Chapter: 1", "Chapter: 1\n⏱ 1 min"],
        ["002. Chapter: 2", "Chapter: 2\n⏱ 1 min"],
        ["003. Chapter: 3", "Chapter: 3\n⏱ 1 min"],
      ]);
      expect(api.sendMessage).not.toHaveBeenCalled();
    }
  });

  it("without a group sends a book part's message before its first audio", async () => {
    vi.mocked(syncBook).mockResolvedValue(undefined);
    const chapters = many(3);
    chapters[0]!.text = "Частина перша\nx";
    chapters[2]!.text = "Частина друга\nx";
    const order: string[] = [];
    const api = {
      ...fakeApi(),
      sendMessage: vi.fn(async (_chat: number, text: string) => {
        order.push(text);
        return {};
      }),
      sendAudio: vi.fn(
        async (_chat: number, _file: unknown, extra: { title: string }) => {
          order.push(extra.title);
          return {};
        },
      ),
    };
    await voiceBook(api as unknown as Api, 5, book, voice, chapters, "new");
    expect(order).toEqual([
      "📖 <b>Частина перша</b>\n⏱ 1 min",
      "001. Chapter: 1",
      "002. Chapter: 2",
      "📖 <b>Частина друга</b>\n⏱ 1 min",
      "003. Chapter: 3",
    ]);
  });

  it("sends the chapters before a failed one and rethrows", async () => {
    vi.mocked(syncBook).mockResolvedValue(synced([]));
    const chapters = failingThird();
    await expect(
      voiceBook(fakeApi() as unknown as Api, 5, book, voice, chapters, "regen"),
    ).rejects.toThrow("chapter «003 Three»: boom");
    expect(syncBook).toHaveBeenCalledTimes(2);
  });

  it("keeps the chapter's error when the send after it fails too", async () => {
    vi.mocked(syncBook)
      .mockResolvedValueOnce(synced([]))
      .mockRejectedValueOnce(new Error("Invalid library.json"));
    const chapters = failingThird();
    await expect(
      voiceBook(fakeApi() as unknown as Api, 5, book, voice, chapters, "new"),
    ).rejects.toThrow("chapter «003 Three»: boom");
  });

  it("keeps one status message with the chapters voiced so far", async () => {
    events(chapterEvents);
    vi.mocked(syncBook).mockResolvedValue(synced([]));
    const api = fakeApi();
    api.sendMessage.mockResolvedValueOnce({ message_id: 9 });
    await voiceBook(api as unknown as Api, 5, book, voice, todo, "new", {
      done: 3,
      total: 25,
    });
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "<b>⏳ Processing: Audiobook (UA)</b> - Book\n3/25 chapters · ≈1 min left",
      { parse_mode: "HTML" },
    );
    expect(api.editMessageText.mock.calls).toEqual([
      [
        5,
        9,
        "<b>⏳ Processing: Audiobook (UA)</b> - Book\n4/25 chapters · ≈1 min left",
        { parse_mode: "HTML" },
      ],
      // The chapters asked for are done: no time is left in this run.
      [
        5,
        9,
        "<b>⏳ Processing: Audiobook (UA)</b> - Book\n5/25 chapters",
        { parse_mode: "HTML" },
      ],
    ]);
  });

  it("counts re-voiced chapters in regen", async () => {
    events(chapterEvents);
    vi.mocked(syncBook).mockResolvedValue(undefined);
    const api = fakeApi();
    api.sendMessage.mockResolvedValueOnce({ message_id: 9 });
    await voiceBook(api as unknown as Api, 5, book, voice, todo, "regen", {
      done: 0,
      total: 2,
    });
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "<b>⏳ Processing: Audiobook (UA)</b> - Book\n0/2 chapters · ≈1 min left",
      { parse_mode: "HTML" },
    );
    expect(api.editMessageText).toHaveBeenLastCalledWith(
      5,
      9,
      "<b>⏳ Processing: Audiobook (UA)</b> - Book\n2/2 chapters",
      { parse_mode: "HTML" },
    );
  });
});
