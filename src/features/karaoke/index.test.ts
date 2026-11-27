import { Context, type Api } from "grammy";
import type { Update } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { syncKaraoke } from "../../lib/library/karaoke.ts";
import { enableYoutube, karaoke } from "./index.ts";
import { runKaraoke } from "./pipeline.ts";

vi.mock("../../lib/telegram/owner.ts", () => ({ ownerId: () => 7 }));
vi.mock("./youtube.ts", () => ({
  youtube: () => ({
    publish: vi.fn(async () => ({
      url: "https://youtu.be/x",
      inPlaylist: false,
    })),
  }),
}));
vi.mock("../../lib/library/karaoke.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/library/karaoke.ts")>()),
  syncKaraoke: vi.fn(async () => undefined),
}));
vi.mock("../../lib/jobs/jobs.ts", () => ({
  busyWith: vi.fn(),
  startJob: vi.fn((_name: string, job: () => Promise<void>) => {
    void job();
    return true;
  }),
}));
vi.mock("./pipeline.ts", () => ({
  isSeparated: vi.fn(() => false),
  runKaraoke: vi.fn(async function* () {}),
}));

vi.mock("../../lib/video/info.ts", async (original) => ({
  ...(await original<typeof import("../../lib/video/info.ts")>()),
  videoInfo: vi.fn(async (id: string) =>
    id === "lecture0000"
      ? { title: "L", categories: ["Education"], chapters: [] }
      : id === "unknown0000"
        ? undefined
        : { title: "S", categories: ["Music"], chapters: [] },
  ),
}));

enableYoutube({
  clientId: "id",
  clientSecret: "secret",
  playlistId: "list",
});

describe("karaoke.actions", () => {
  it("offers nothing for a YouTube video that is not music", async () => {
    expect(
      await karaoke.actions?.({ kind: "youtube", id: "lecture0000" }),
    ).toBeUndefined();
  });

  it("still offers karaoke when the video's category is unknown", async () => {
    const actions = await karaoke.actions?.({
      kind: "youtube",
      id: "unknown0000",
    });
    expect(actions?.buttons).toHaveLength(1);
  });

  it("offers karaoke for a YouTube video, with the version as its question", async () => {
    const actions = await karaoke.actions?.({
      kind: "youtube",
      id: "dQw4w9WgXcQ",
    });
    expect(actions?.buttons).toEqual([
      { text: "🎤 Karaoke", data: "karaoke:open:dQw4w9WgXcQ" },
    ]);
    expect(actions?.ask).toBeTypeOf("function");
  });

  it("offers nothing for another link", async () => {
    expect(
      await karaoke.actions?.({ kind: "link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});

function fakeApi() {
  return {
    sendMessage: vi.fn(async (_chatId: number, _text: string) => ({
      message_id: 1,
    })),
    sendChatAction: vi.fn(async () => true),
    deleteMessage: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
  };
}

/** The owner presses a «Make it» button in the library group. */
async function pressMake(api: ReturnType<typeof fakeApi>, data: string) {
  const group = { id: -1001, type: "supergroup", title: "Library" };
  const update = {
    update_id: 1,
    callback_query: {
      id: "q",
      chat_instance: "c",
      from: { id: 7, is_bot: false, first_name: "Owner" },
      data,
      message: { message_id: 9, date: 0, chat: group },
    },
  } as unknown as Update;
  const ctx = new Context(update, api as unknown as Api, {} as Context["me"]);
  await karaoke.composer!.middleware()(ctx, async () => {});
}

describe("karaoke make-it button", () => {
  it("make-it button runs the job in the private chat", async () => {
    const api = fakeApi();
    await pressMake(api, "karaoke:make:dQw4w9WgXcQ:vocals");
    expect(api.sendMessage.mock.calls[0]?.[0]).toBe(7);
    expect(api.answerCallbackQuery).toHaveBeenCalled();
    expect(api.editMessageReplyMarkup).not.toHaveBeenCalled();
  });
});

describe("karaoke done message", () => {
  it("says the video was not added to the playlist", async () => {
    vi.mocked(runKaraoke).mockImplementationOnce(async function* () {
      yield {
        video: "/k/Song/Song (Karaoke).mp4",
        full: "/k/Song/Song (Karaoke).mp4",
        title: "Song",
        duration: 1,
        width: 1,
        height: 1,
      };
    });
    vi.mocked(syncKaraoke).mockResolvedValueOnce({
      changed: [],
      link: () => "https://t.me/c/1/2/3",
    });
    const api = fakeApi();
    await pressMake(api, "karaoke:make:dQw4w9WgXcQ:music");
    await vi.waitFor(() =>
      expect(api.sendMessage).toHaveBeenCalledWith(
        7,
        "✅ <b>Done</b> → https://t.me/c/1/2/3 (not added to the playlist)",
        { parse_mode: "HTML" },
      ),
    );
  });
});

describe("karaoke lyrics not found", () => {
  it("says the lyrics service is unreachable and offers both buttons", async () => {
    vi.mocked(runKaraoke).mockImplementationOnce(async function* () {
      yield { needLyrics: "unreachable", transcript: "la la" };
    });
    const api = fakeApi();
    await pressMake(api, "karaoke:make:dQw4w9WgXcQ:music");
    await vi.waitFor(() =>
      expect(api.sendMessage).toHaveBeenCalledWith(
        7,
        "⚠️ <b>The lyrics service (LRCLIB) is unreachable</b>",
        expect.objectContaining({ parse_mode: "HTML" }),
      ),
    );
  });
});
