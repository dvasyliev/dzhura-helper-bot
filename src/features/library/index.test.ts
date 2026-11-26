import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { ChatMember } from "grammy/types";
import type { Api } from "grammy";
import { bookFolders, syncBook } from "./books.ts";
import {
  keepsTopics,
  memberChange,
  missingRights,
  privateOnly,
  publish,
} from "./index.ts";
import { loadState, saveState } from "./state.ts";
import { describeShelf } from "./describe.ts";
import { syncKaraoke } from "./karaoke.ts";
import type { Synced } from "./topic.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));
vi.mock("./books.ts", () => ({ bookFolders: vi.fn(), syncBook: vi.fn() }));
vi.mock("./describe.ts", () => ({ describeShelf: vi.fn(async () => {}) }));
vi.mock("./karaoke.ts", () => ({ syncKaraoke: vi.fn() }));

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
    const reply = vi.fn(async () => undefined);
    await publish(api, reply);
    expect(syncKaraoke).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      "⚠️ <b>Publishing stopped</b>\nThe library group is unavailable.",
    );
  });

  it("describes the voiced tracks before syncing, with the status callback", async () => {
    const order: string[] = [];
    vi.mocked(describeShelf).mockImplementationOnce(async () => {
      order.push("describe");
    });
    vi.mocked(bookFolders).mockResolvedValue(["A"]);
    vi.mocked(syncBook).mockImplementation(async () => {
      order.push("sync");
      return done;
    });
    vi.mocked(syncKaraoke).mockResolvedValue(done);
    const show = async () => {};
    await publish(
      api,
      vi.fn(async () => undefined),
      show,
    );
    expect(describeShelf).toHaveBeenLastCalledWith(show);
    expect(order).toEqual(["describe", "sync"]);
  });

  it("probes every topic and says how many are up to date", async () => {
    vi.mocked(bookFolders).mockResolvedValue(["A"]);
    vi.mocked(syncBook).mockResolvedValue(done);
    vi.mocked(syncKaraoke).mockResolvedValue(done);
    const reply = vi.fn(async () => undefined);
    await publish(api, reply);
    expect(syncBook).toHaveBeenCalledWith(api, "A", undefined, {
      probe: true,
    });
    expect(syncKaraoke).toHaveBeenCalledWith(api, undefined, { probe: true });
    expect(reply).toHaveBeenCalledWith(
      "✅ <b>Library is up to date</b>\n\n<blockquote>2 topics</blockquote>",
    );
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
