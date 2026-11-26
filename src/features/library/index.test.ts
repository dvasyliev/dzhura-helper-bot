import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { ChatMember } from "grammy/types";
import type { Api } from "grammy";
import { bookFolders, syncBook } from "./books.ts";
import { keepsTopics, missingRights, privateOnly, publish } from "./index.ts";
import { syncKaraoke } from "./karaoke.ts";
import type { Synced } from "./topic.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));
vi.mock("./books.ts", () => ({ bookFolders: vi.fn(), syncBook: vi.fn() }));
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
      "Publishing stopped: the library group is unavailable.",
    );
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
    expect(reply).toHaveBeenCalledWith("Library is up to date: 2 topics.");
  });
});
