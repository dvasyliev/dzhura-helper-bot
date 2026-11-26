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
vi.mock("./descriptions.ts", async (original) => ({
  ...(await original<typeof import("./descriptions.ts")>()),
  readDescriptions: vi.fn(async () => ({ "001": "Про <розділ>." })),
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
  { index: 0, name: "001 One", text: "one" },
  { index: 1, name: "002 Two", text: "two" },
];

/** Chapters 001…`n`, each voiced into one file. */
function many(n: number) {
  const chapters = Array.from({ length: n }, (_, i) => ({
    index: i,
    name: String(i + 1).padStart(3, "0"),
    text: "x",
  }));
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
  return [...todo, { index: 2, name: "003 Three", text: "x" }];
}

function synced(changed: string[]): Synced {
  return { changed, link: (key) => `https://t.me/c/1/2/${key}` };
}

beforeEach(() => {
  vi.mocked(syncBook).mockReset();
});

describe("voiceBook", () => {
  it("sends the first chapter at once, then every 10, then the rest; Done once", async () => {
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
    // After chapter 1, chapter 11 (10 more), and 12 at the end.
    expect(sentAfter).toEqual([0, 11, 12]);
    expect(syncBook).toHaveBeenCalledWith(api, folder);
    expect(api.sendAudio).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      5,
      "✅ <b>Done</b> → https://t.me/c/1/2/voice:Voice/001.mp3",
      { parse_mode: "HTML" },
    );
  });

  it("without a group sends the audio here, titled by chapter, in albums", async () => {
    vi.mocked(syncBook).mockResolvedValue(undefined);
    for (const mode of ["new", "regen"] as const) {
      const chapters = many(3);
      const api = fakeApi();
      await voiceBook(api as unknown as Api, 5, book, voice, chapters, mode);
      expect(api.sendAudio).toHaveBeenCalledTimes(1);
      expect(api.sendAudio).toHaveBeenCalledWith(5, expect.anything(), {
        title: "001",
        parse_mode: "HTML",
        caption: "Про &lt;розділ&gt;.",
      });
      const [[, album]] = api.sendMediaGroup.mock.calls as unknown as [
        [number, { title: string }[]],
      ];
      expect(album.map((a) => a.title)).toEqual(["002", "003"]);
      expect(api.sendMessage).not.toHaveBeenCalled();
    }
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
