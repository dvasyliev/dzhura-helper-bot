import type { Api } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncBook } from "../library/books.ts";
import { hasGroup } from "../library/group.ts";
import type { Synced } from "../library/topic.ts";
import { voiceBook } from "./deliver.ts";
import { voiceChapters, type Voice, type VoiceEvent } from "./voice.ts";

vi.mock("./voice.ts", () => ({ voiceChapters: vi.fn() }));
vi.mock("../library/books.ts", () => ({ syncBook: vi.fn() }));
vi.mock("../library/group.ts", () => ({ hasGroup: vi.fn() }));

const book = { title: "Book", author: "Author", chapters: [] };
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
const folder = "Author - Book";

function fakeApi() {
  return {
    sendAudio: vi.fn(async () => ({})),
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

function synced(changed: string[]): Synced {
  return { changed, link: (key) => `https://t.me/c/1/2/${key}` };
}

beforeEach(() => {
  vi.mocked(syncBook).mockReset();
  vi.mocked(hasGroup).mockReset().mockResolvedValue(true);
});

describe("voiceBook", () => {
  it("new mode syncs after each chapter and says Done once", async () => {
    events(chapterEvents);
    vi.mocked(syncBook)
      .mockResolvedValueOnce(
        synced(["contents", "voice:Voice", "voice:Voice/001 One.mp3"]),
      )
      .mockResolvedValueOnce(synced(["contents", "voice:Voice/002 Two.mp3"]));
    const api = fakeApi();
    await voiceBook(api as unknown as Api, 5, book, voice, todo, "new");
    expect(syncBook).toHaveBeenCalledTimes(2);
    expect(syncBook).toHaveBeenCalledWith(api, folder);
    expect(api.sendAudio).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "Done → https://t.me/c/1/2/voice:Voice/001 One.mp3",
    );
  });

  it("regen syncs once at the end", async () => {
    events(chapterEvents);
    vi.mocked(syncBook).mockResolvedValueOnce(
      synced(["contents", "voice:Voice/002 Two.mp3"]),
    );
    const api = fakeApi();
    await voiceBook(api as unknown as Api, 5, book, voice, todo, "regen");
    expect(syncBook).toHaveBeenCalledTimes(1);
    expect(api.sendAudio).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "Done → https://t.me/c/1/2/voice:Voice/002 Two.mp3",
    );
  });

  it("without a group sends the audio here", async () => {
    events(chapterEvents);
    vi.mocked(syncBook).mockResolvedValue(undefined);
    vi.mocked(hasGroup).mockResolvedValue(false);
    for (const mode of ["new", "regen"] as const) {
      const api = fakeApi();
      await voiceBook(api as unknown as Api, 5, book, voice, todo, mode);
      expect(api.sendAudio).toHaveBeenCalledTimes(2);
      expect(api.sendAudio).toHaveBeenCalledWith(5, expect.anything(), {
        title: "001 One",
        performer: "Book",
      });
      expect(api.sendMessage).not.toHaveBeenCalled();
    }
  });

  it("regen with a group syncs once after a failed chapter and rethrows", async () => {
    events([
      { chapter: 0, files: ["/a/001 One.mp3"] },
      { chapter: 1, error: "boom" },
    ]);
    vi.mocked(syncBook).mockResolvedValueOnce(
      synced(["voice:Voice/001 One.mp3"]),
    );
    const api = fakeApi();
    await expect(
      voiceBook(api as unknown as Api, 5, book, voice, todo, "regen"),
    ).rejects.toThrow("chapter «002 Two»: boom");
    expect(syncBook).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "Done → https://t.me/c/1/2/voice:Voice/001 One.mp3",
    );
  });

  it("regen keeps the chapter's error when the sync after it fails too", async () => {
    events([{ chapter: 0, error: "boom" }]);
    vi.mocked(syncBook).mockRejectedValueOnce(
      new Error("Invalid library.json"),
    );
    await expect(
      voiceBook(fakeApi() as unknown as Api, 5, book, voice, todo, "regen"),
    ).rejects.toThrow("chapter «001 One»: boom");
  });

  it("regen without a group sends each chapter as it finishes", async () => {
    vi.mocked(hasGroup).mockResolvedValue(false);
    const api = fakeApi();
    const sentBeforeSecond: number[] = [];
    vi.mocked(voiceChapters).mockImplementation(async function* () {
      yield chapterEvents[0]!;
      sentBeforeSecond.push(api.sendAudio.mock.calls.length);
      yield chapterEvents[1]!;
    });
    await voiceBook(api as unknown as Api, 5, book, voice, todo, "regen");
    expect(sentBeforeSecond).toEqual([1]);
    expect(api.sendAudio).toHaveBeenCalledTimes(2);
    expect(syncBook).not.toHaveBeenCalled();
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
      "Voicing «Book»: 3 of 25 chapters.",
    );
    expect(api.editMessageText.mock.calls).toEqual([
      [5, 9, "Voicing «Book»: 4 of 25 chapters."],
      [5, 9, "Voicing «Book»: 5 of 25 chapters."],
    ]);
  });

  it("counts re-voiced chapters in regen", async () => {
    events(chapterEvents);
    vi.mocked(hasGroup).mockResolvedValue(false);
    const api = fakeApi();
    api.sendMessage.mockResolvedValueOnce({ message_id: 9 });
    await voiceBook(api as unknown as Api, 5, book, voice, todo, "regen", {
      done: 0,
      total: 2,
    });
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "Re-voicing «Book»: 0 of 2 chapters.",
    );
    expect(api.editMessageText).toHaveBeenLastCalledWith(
      5,
      9,
      "Re-voicing «Book»: 2 of 2 chapters.",
    );
  });
});
