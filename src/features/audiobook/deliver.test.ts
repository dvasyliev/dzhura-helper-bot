import type { Api } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncBook } from "../library/books.ts";
import type { Synced } from "../library/topic.ts";
import { voiceBook } from "./deliver.ts";
import { voiceChapters, type Voice, type VoiceEvent } from "./voice.ts";

vi.mock("./voice.ts", () => ({ voiceChapters: vi.fn() }));
vi.mock("../translate/claude.ts", () => ({
  runClaude: vi.fn(async () => "Про розділ."),
}));
/** The book's tracks, as `chapters(book)` returns them; each test sets its own. */
const tracks = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("./library.ts", () => ({ chapters: () => tracks.list }));
vi.mock("./parts.ts", async (original) => ({
  ...(await original<typeof import("./parts.ts")>()),
  describeParts: () => async () => {},
  readParts: vi.fn(async () => ({ "001|003": "Про <море>." })),
}));
vi.mock("../library/books.ts", () => ({ syncBook: vi.fn() }));

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
  it("sends the first chapter at once, then each part when it is voiced, then the rest; Done once", async () => {
    const chapters = many(12);
    const api = fakeApi();
    const sentAfter: number[] = [];
    vi.mocked(syncBook).mockImplementation(async () => {
      sentAfter.push(api.editMessageText.mock.calls.length);
      return synced([]);
    });
    vi.mocked(syncBook).mockImplementationOnce(async () => {
      sentAfter.push(0);
      return synced(["contents", "voice:Voice", "voice:Voice/001.mp3"]);
    });
    api.sendMessage.mockResolvedValueOnce({ message_id: 9 });
    await voiceBook(api as unknown as Api, 5, book, voice, chapters, "new", {
      done: 0,
      total: 12,
    });
    // After chapter 1, chapter 10 (the end of the first part of 10 tracks), and 12 at the end.
    expect(sentAfter).toEqual([0, 10, 12]);
    expect(syncBook).toHaveBeenCalledWith(api, folder);
    expect(api.sendAudio).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      5,
      "✅ <b>Done</b> → https://t.me/c/1/2/voice:Voice/001.mp3",
      { parse_mode: "HTML" },
    );
  });

  it("without a group sends the part message before its audio, with the chapter titles as captions", async () => {
    vi.mocked(syncBook).mockResolvedValue(undefined);
    for (const mode of ["new", "regen"] as const) {
      const chapters = many(3);
      const api = fakeApi();
      await voiceBook(api as unknown as Api, 5, book, voice, chapters, mode);
      expect(api.sendAudio).toHaveBeenCalledTimes(1);
      expect(api.sendAudio).toHaveBeenCalledWith(5, expect.anything(), {
        title: "001. Chapter: 1",
      });
      const [[, album]] = api.sendMediaGroup.mock.calls as unknown as [
        [number, { title: string }[]],
      ];
      expect(album.map((a) => a.title)).toEqual([
        "002. Chapter: 2",
        "003. Chapter: 3",
      ]);
      // The part message goes once, before the first audio, with the saved description.
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      expect(api.sendMessage).toHaveBeenCalledWith(
        5,
        "🎧 <b>Part 1</b> · tracks 1–3 · ≈1 min\n\nПро &lt;море&gt;.",
        { parse_mode: "HTML" },
      );
    }
  });

  it("without a group sends each part's message once, before its first audio", async () => {
    vi.mocked(syncBook).mockResolvedValue(undefined);
    const long = Array.from({ length: 3 }, (_, i) => ({
      index: i,
      name: `00${i + 1}`,
      text: "x".repeat(30_000),
      title: `T${i + 1}`,
    }));
    tracks.list = long;
    events(
      long.map((c) => ({ chapter: c.index, files: [`/a/${c.name}.mp3`] })),
    );
    const order: string[] = [];
    const api = {
      ...fakeApi(),
      sendMessage: vi.fn(async (_chat: number, text: string) => {
        order.push(text.split(" · ")[0]!);
        return {};
      }),
      sendAudio: vi.fn(
        async (_chat: number, _file: unknown, extra: { title: string }) => {
          order.push(extra.title);
          return {};
        },
      ),
    };
    await voiceBook(api as unknown as Api, 5, book, voice, long, "new");
    // 30000-character tracks: one per part.
    expect(order).toEqual([
      "🎧 <b>Part 1</b>",
      "001. T1",
      "🎧 <b>Part 2</b>",
      "002. T2",
      "🎧 <b>Part 3</b>",
      "003. T3",
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
      "🎧 <b>Voicing «Book»</b>\n3 of 25 chapters · ≈1 min left",
      { parse_mode: "HTML" },
    );
    expect(api.editMessageText.mock.calls).toEqual([
      [
        5,
        9,
        "🎧 <b>Voicing «Book»</b>\n4 of 25 chapters · ≈1 min left",
        { parse_mode: "HTML" },
      ],
      // The chapters asked for are done: no time is left in this run.
      [
        5,
        9,
        "🎧 <b>Voicing «Book»</b>\n5 of 25 chapters",
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
      "🎧 <b>Re-voicing «Book»</b>\n0 of 2 chapters · ≈1 min left",
      { parse_mode: "HTML" },
    );
    expect(api.editMessageText).toHaveBeenLastCalledWith(
      5,
      9,
      "🎧 <b>Re-voicing «Book»</b>\n2 of 2 chapters",
      { parse_mode: "HTML" },
    );
  });
});
