import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { ChatMember } from "grammy/types";
import type { Api } from "grammy";
import { tryLoadBook } from "../../lib/shelf/shelf.ts";
import { bookInfo } from "../../lib/book/info.ts";
import { bookFolders, syncBook } from "../../lib/library/books.ts";
import {
  keepsTopics,
  memberChange,
  missingRights,
  privateOnly,
  publish,
} from "./index.ts";
import { loadState, saveState } from "../../lib/library/state.ts";
import { syncKaraoke } from "../../lib/library/karaoke.ts";
import { syncSummaries } from "../../lib/library/summary.ts";
import type { Synced } from "../../lib/library/topic/topic.ts";

vi.mock("../../lib/telegram/owner.ts", () => ({ ownerId: () => 7 }));
vi.mock("../../lib/library/books.ts", () => ({
  bookFolders: vi.fn(),
  syncBook: vi.fn(),
  topicName: (book: { title: string }) => book.title,
}));
vi.mock("../../lib/library/karaoke.ts", () => ({ syncKaraoke: vi.fn() }));
vi.mock("../../lib/library/summary.ts", () => ({ syncSummaries: vi.fn() }));
vi.mock("../../lib/shelf/shelf.ts", () => ({
  tryLoadBook: vi.fn(async () => undefined),
}));
vi.mock("../../lib/book/info.ts", () => ({
  bookInfo: vi.fn(async () => ({})),
}));

const user = { id: 1, is_bot: true, first_name: "bot" };
const admin = {
  status: "administrator",
  user,
  can_manage_topics: true,
  can_delete_messages: true,
  can_pin_messages: true,
} as unknown as ChatMember;
const plain = { status: "member", user } as unknown as ChatMember;

describe("missingRights", () => {
  it("is empty for a forum admin with all rights", () => {
    expect(missingRights(true, admin)).toEqual([]);
  });
  it("lists three rights for a plain member", () => {
    expect(missingRights(true, plain)).toEqual([
      "manage topics",
      "delete messages",
      "pin messages",
    ]);
  });
  it("mentions topics being off", () => {
    expect(missingRights(false, admin)).toContain("topics are off");
  });
});

describe("privateOnly", () => {
  const run = async (update: object) => {
    const next = vi.fn();
    await privateOnly(update as unknown as Context, next);
    return next;
  };
  it("ignores messages outside the private chat", async () => {
    const next = await run({ message: {}, chat: { type: "supergroup" } });
    expect(next).not.toHaveBeenCalled();
  });
  it("lets private messages and other updates through", async () => {
    expect(
      await run({ message: {}, chat: { type: "private" } }),
    ).toHaveBeenCalled();
    expect(
      await run({ myChatMember: {}, chat: { type: "supergroup" } }),
    ).toHaveBeenCalled();
  });
});

describe("keepsTopics", () => {
  const topics = {};
  it("keeps them when the bot comes back to the group it left", () => {
    expect(keepsTopics({ lastChatId: -100, topics }, -100)).toBe(true);
  });
  it("keeps them for the current group", () => {
    expect(keepsTopics({ chatId: -100, topics }, -100)).toBe(true);
  });
  it("drops them for another group", () => {
    expect(keepsTopics({ lastChatId: -100, topics }, -200)).toBe(false);
    expect(keepsTopics({ chatId: -100, topics }, -200)).toBe(false);
  });
});

describe("publish", () => {
  const done: Synced = { changed: [], link: () => undefined };
  const api = {} as Api;

  it("says when the group became unavailable", async () => {
    vi.mocked(bookFolders).mockResolvedValue(["A", "B"]);
    vi.mocked(syncBook)
      .mockResolvedValueOnce(done)
      .mockResolvedValueOnce(undefined);
    const show = vi.fn(async () => undefined);
    await publish(api, show);
    expect(syncKaraoke).not.toHaveBeenCalled();
    expect(show).toHaveBeenLastCalledWith(
      [
        "⚠️ <b>Publishing stopped</b> · the library group is unavailable",
        "",
        "✅ no changes | A",
        "🔄 B",
        "⏳ Karaoke",
        "⏳ Summaries",
      ].join("\n"),
      true,
    );
  });

  it("counts a song or a video once, whatever files changed", async () => {
    vi.mocked(bookFolders).mockResolvedValue([]);
    vi.mocked(syncKaraoke).mockResolvedValue({
      ...done,
      changed: ["contents", "a/song", "a/music", "a/vocals"],
    });
    vi.mocked(syncSummaries).mockResolvedValue({
      ...done,
      changed: ["contents", "v1/about", "v1/summary", "v1/audio", "v2/about"],
    });
    const show = vi.fn(async (_text: string, _final?: boolean) => undefined);
    await publish(api, show);
    const text = show.mock.calls.at(-1)![0];
    expect(text).toContain("1 updated | Karaoke");
    expect(text).toContain("2 updated | Summaries");
  });

  it("probes every topic and says how many are up to date", async () => {
    vi.mocked(bookFolders).mockResolvedValue(["A"]);
    vi.mocked(syncBook).mockResolvedValue(done);
    vi.mocked(syncKaraoke).mockResolvedValue(done);
    vi.mocked(syncSummaries).mockResolvedValue(done);
    const show = vi.fn(async () => undefined);
    await publish(api, show);
    const probe = { probe: true, progress: expect.any(Function) };
    expect(syncBook).toHaveBeenCalledWith(api, "A", undefined, probe);
    expect(syncKaraoke).toHaveBeenCalledWith(api, undefined, probe);
    expect(syncSummaries).toHaveBeenCalledWith(api, undefined, probe);
    expect(show).toHaveBeenLastCalledWith(
      expect.stringMatching(/^✅ <b>Library is up to date<\/b> · 3 topics\n/),
      true,
    );
  });

  it("shows each topic's progress while it syncs, and its name", async () => {
    vi.mocked(bookFolders).mockResolvedValue(["A"]);
    vi.mocked(tryLoadBook).mockResolvedValue({ title: "Book A" } as never);
    vi.mocked(syncBook).mockImplementation(
      async (_api, _folder, _dirs, options) => {
        options?.progress?.(1, 2);
        return { ...done, changed: ["x", "y"], topic: "https://t.me/c/1/5" };
      },
    );
    vi.mocked(syncKaraoke).mockResolvedValue(done);
    vi.mocked(syncSummaries).mockResolvedValue(done);
    const show = vi.fn(async () => undefined);
    await publish(api, show);
    const texts = show.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(texts).toContainEqual(expect.stringContaining("🔄 1/2 | Book A"));
    expect(texts.at(-1)).toContain(
      '✅ 2 updated | <a href="https://t.me/c/1/5">Book A</a>',
    );
  });

  it("first makes each book's missing info (cover, year, description), then syncs", async () => {
    const order: string[] = [];
    const book = { title: "A", chapters: [] };
    vi.mocked(bookFolders).mockResolvedValue(["A"]);
    vi.mocked(tryLoadBook).mockResolvedValue(book as never);
    vi.mocked(bookInfo).mockImplementationOnce(async () => {
      order.push("info");
      return {};
    });
    vi.mocked(syncBook).mockImplementation(async () => {
      order.push("sync");
      return done;
    });
    vi.mocked(syncKaraoke).mockResolvedValue(done);
    await publish(
      api,
      vi.fn(async () => undefined),
    );
    expect(bookInfo).toHaveBeenCalledWith("A", book, {
      waitMs: 2 ** 31 - 1,
    });
    expect(order).toEqual(["info", "sync"]);
  });
});

describe("memberChange", () => {
  const group = (id: number) =>
    ({ id, type: "supergroup", title: "Library", is_forum: true }) as const;
  const left = { status: "left", user } as unknown as ChatMember;

  it("saves the group and says which rights are missing", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "member-")), "library.json");
    expect(await memberChange(group(-1), admin, file)).toBe(
      "✅ <b>Library group saved</b>",
    );
    expect(await memberChange(group(-1), plain, file)).toBe(
      "⚠️ <b>Library group saved, but I need</b>\nmanage topics, delete messages, pin messages",
    );
    expect((await loadState(file)).chatId).toBe(-1);
  });

  it("forgets the group on leaving, keeping its topics for a return", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "member-")), "library.json");
    const topic = { threadId: 3, messages: [], tooBig: {} };
    await saveState({ chatId: -1, topics: { a: topic } }, file);
    expect(await memberChange(group(-1), left, file)).toBe(
      "📚 <b>Removed from the library group</b>\nResults come here again.",
    );
    expect(await loadState(file)).toEqual({
      lastChatId: -1,
      topics: { a: topic },
    });
    expect(await memberChange(group(-2), left, file)).toBeUndefined();
  });

  it("ignores chats that are not supergroups", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "member-")), "library.json");
    const chat = { id: 5, type: "group", title: "x" } as const;
    expect(await memberChange(chat, admin, file)).toBeUndefined();
  });
});
