import { Context, type Api, type Composer } from "grammy";
import type { Update } from "grammy/types";

/** The owner (id 7) presses a button with `data` under message 9 in the library group; `message` adds to that message. */
export async function pressButton(
  composer: Composer<Context>,
  api: unknown,
  data: string,
  message: Record<string, unknown> = {},
): Promise<void> {
  const group = { id: -1001, type: "supergroup", title: "Library" };
  const update = {
    update_id: 1,
    callback_query: {
      id: "q",
      chat_instance: "c",
      from: { id: 7, is_bot: false, first_name: "Owner" },
      data,
      message: { message_id: 9, date: 0, chat: group, ...message },
    },
  } as unknown as Update;
  const ctx = new Context(update, api as Api, {} as Context["me"]);
  await composer.middleware()(ctx, async () => {});
}
