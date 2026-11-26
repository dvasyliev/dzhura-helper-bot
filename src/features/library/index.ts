import { Composer, type Api, type Context, type NextFunction } from "grammy";
import type { Chat, ChatMember } from "grammy/types";
import { config } from "../../config.ts";
import { busyWith, startJob } from "../../jobs.ts";
import { message } from "../audiobook/deliver.ts";
import { bookFolders, syncBook } from "./books.ts";
import { resetUnavailable } from "./group.ts";
import { syncKaraoke } from "./karaoke.ts";
import {
  LIBRARY_FILE,
  loadState,
  saveState,
  serial,
  type LibraryState,
} from "./state.ts";

export const PUBLISH_COMMAND = {
  command: "publish",
  description: "📚 Update the library",
};

/** Rights the bot lacks in a forum group, in words: "topics are off", "manage topics", "delete messages", "pin messages". */
export function missingRights(isForum: boolean, member: ChatMember): string[] {
  const admin = member.status === "administrator" ? member : undefined;
  return [
    ...(isForum ? [] : ["topics are off"]),
    ...(admin?.can_manage_topics ? [] : ["manage topics"]),
    ...(admin?.can_delete_messages ? [] : ["delete messages"]),
    ...(admin?.can_pin_messages ? [] : ["pin messages"]),
  ];
}

/** True when joining `chatId` keeps the saved topics: it is the current group or the one the bot left. */
export function keepsTopics(state: LibraryState, chatId: number): boolean {
  return chatId === (state.chatId ?? state.lastChatId);
}

/** Drops messages from groups; callback queries and chat-member updates pass. */
export async function privateOnly(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  if (ctx.message && ctx.chat?.type !== "private") return;
  await next();
}

const STOPPED = "Publishing stopped: the library group is unavailable.";

/** Syncs every topic, checking each still exists, and replies how it went. */
export async function publish(
  api: Api,
  reply: (text: string) => Promise<unknown>,
): Promise<void> {
  const folders = await bookFolders();
  const synced = async (): Promise<boolean> => {
    for (const folder of folders)
      if (!(await syncBook(api, folder, undefined, { probe: true })))
        return false;
    return (await syncKaraoke(api, undefined, { probe: true })) !== undefined;
  };
  await reply(
    (await synced())
      ? `Library is up to date: ${folders.length + 1} topics.`
      : STOPPED,
  );
}

export const library = new Composer<Context>();

/** Saves or forgets the group when the bot joins or leaves `chat`; the note for the owner, if any. */
export function memberChange(
  chat: Chat,
  member: ChatMember,
  file = LIBRARY_FILE,
): Promise<string | undefined> {
  const joined =
    member.status === "administrator" || member.status === "member";
  const left = member.status === "left" || member.status === "kicked";
  if (chat.type !== "supergroup" || (!joined && !left))
    return Promise.resolve(undefined);
  return serial(async () => {
    const state = await loadState(file);
    if (joined) {
      if (!keepsTopics(state, chat.id)) state.topics = {};
      state.chatId = chat.id;
      delete state.lastChatId;
      await saveState(state, file);
      resetUnavailable();
      const missing = missingRights(chat.is_forum === true, member);
      return missing.length
        ? `Library group saved, but I need: ${missing.join(", ")}.`
        : "Library group saved.";
    }
    if (state.chatId !== chat.id) return undefined;
    state.lastChatId = chat.id;
    delete state.chatId;
    await saveState(state, file);
    return "Removed from the library group; results come here again.";
  });
}

library.on("my_chat_member", async (ctx) => {
  const { chat, new_chat_member: member } = ctx.myChatMember;
  const note = await memberChange(chat, member);
  if (note) await ctx.api.sendMessage(config.ownerId, note);
});

library.command("publish", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  if ((await loadState()).chatId === undefined)
    return ctx.reply(
      "Puts every book and song into the library group. Set it up first: create a group, turn on Topics, and add me as admin with «Manage topics», «Delete messages» and «Pin messages». Then send /publish again.",
    );
  const started = startJob(
    "publishing the library",
    () => publish(ctx.api, (text) => ctx.reply(text)),
    async (error) => {
      await ctx.reply(`Publishing failed: ${message(error)}`);
    },
  );
  if (!started) await ctx.reply(`Please wait, ${busyWith()} is in progress.`);
});
