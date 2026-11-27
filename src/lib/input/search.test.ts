import { Context, type Api } from "grammy";
import type { Update } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { bookSearch } from "./search.ts";

const FOLDER = "Josh Waitzkin - The Art of Learning";
const BOOK = {
  title: "The Art of Learning",
  author: "Josh Waitzkin",
  chapters: [{ title: "One", text: "The quick brown fox jumps." }],
  folder: FOLDER,
};

vi.mock("../shelf/shelf.ts", () => ({
  shelf: vi.fn(async () => [FOLDER]),
  MAX_FOUND: 5,
  loadBook: vi.fn(async () => BOOK),
}));

const from = { id: 7, is_bot: false, first_name: "Owner" };
const chat = { id: 7, type: "private" as const, first_name: "Owner" };

function fakeApi() {
  return {
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
  };
}

async function send(
  composer: ReturnType<typeof bookSearch>,
  api: ReturnType<typeof fakeApi>,
  update: Partial<Update>,
) {
  const ctx = new Context(
    { update_id: 1, ...update } as Update,
    api as unknown as Api,
    { id: 1, is_bot: true, first_name: "Bot", username: "bot" } as never,
  );
  await composer.middleware()(ctx, async () => {});
}

describe("bookSearch", () => {
  it("shows a found book with every feature's actions, not only voicing", async () => {
    const show = vi.fn();
    const composer = bookSearch(show);
    const api = fakeApi();
    await send(composer, api, {
      message: { message_id: 1, date: 0, chat, from, text: "art of learning" },
    });
    expect(api.sendMessage.mock.calls[0]).toContain(
      `❓ <b>«${FOLDER}»: this one?</b>`,
    );

    await send(composer, api, {
      callback_query: {
        id: "q",
        chat_instance: "c",
        from,
        data: "found:0",
        message: { message_id: 1, date: 0, chat, text: "" },
      },
    });
    expect(show).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "book", book: BOOK, folder: FOLDER }),
    );
  });
});
