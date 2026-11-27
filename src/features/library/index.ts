import { Composer, type Api, type Context, type NextFunction } from "grammy";
import type { Chat, ChatMember } from "grammy/types";
import { ownerId } from "../../lib/telegram/owner.ts";
import { busyHtml, startJob } from "../../lib/jobs/jobs.ts";
import { bold, escape, HTML, problem } from "../../lib/text/format.ts";
import { tryLoadBook } from "../../lib/shelf/shelf.ts";
import { bookInfo } from "../../lib/book/info.ts";
import { bookFolders, syncBook, topicName } from "../../lib/library/books.ts";
import {
  liveStatus,
  publishStatus,
  type Row,
} from "../../lib/library/progress.ts";
import type { Synced } from "../../lib/library/topic/topic.ts";
import { resetUnavailable } from "../../lib/library/group.ts";
import { syncKaraoke } from "../../lib/library/karaoke.ts";
import { syncSummaries } from "../../lib/library/summary.ts";
import {
  LIBRARY_FILE,
  loadState,
  saveState,
  serial,
  type LibraryState,
} from "../../lib/library/state.ts";

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

/** setTimeout's longest wait: the info is waited for to the end. */
const NO_LIMIT = 2 ** 31 - 1;

/** Syncs one topic, telling `progress` how far it got; undefined when the group is unavailable. */
type Step = (
  progress: (done: number, total: number) => void,
) => Promise<Synced | undefined>;

/** Songs or videos changed, not messages: the keys are `<item>/<part>`, and the contents message (no slash) is not counted. */
function units(changed: string[]): number {
  return new Set(
    changed.filter((k) => k.includes("/")).map((k) => k.split("/")[0]),
  ).size;
}

/**
 * Syncs every topic, checking each still exists; a book's missing info (cover, year, description; see bookInfo) is
 * made first, so its topic shows the cover. `show` gets the status (see publishStatus) as it changes, the last one
 * `final`.
 */
export async function publish(
  api: Api,
  show: (text: string, final?: boolean) => Promise<void>,
): Promise<void> {
  const folders = await bookFolders();
  const books = await Promise.all(folders.map((folder) => tryLoadBook(folder)));
  const rows: Row[] = [
    ...folders.map((folder, i): Row => {
      const book = books[i];
      return { name: book ? topicName(book) : folder, state: "waiting" };
    }),
    { name: "Karaoke", state: "waiting" },
    { name: "Summaries", state: "waiting" },
  ];
  const steps: Step[] = [
    ...folders.map((folder, i): Step => async (progress) => {
      const book = books[i];
      if (book) await bookInfo(folder, book, { waitMs: NO_LIMIT });
      return syncBook(api, folder, undefined, { probe: true, progress });
    }),
    (progress) => syncKaraoke(api, undefined, { probe: true, progress }),
    (progress) => syncSummaries(api, undefined, { probe: true, progress }),
  ];
  await show(publishStatus(rows));
  for (const [i, step] of steps.entries()) {
    const row = rows[i]!;
    row.state = "running";
    await show(publishStatus(rows));
    const synced = await step((done, total) => {
      row.sent = [done, total];
      void show(publishStatus(rows));
    });
    if (!synced) return show(publishStatus(rows, "stopped"), true);
    Object.assign(row, {
      state: "done",
      changed:
        i < folders.length ? synced.changed.length : units(synced.changed),
      link: synced.topic,
    });
  }
  await show(publishStatus(rows, "done"), true);
}

export const library = new Composer<Context>();

/** Saves or forgets the group when the bot joins or leaves `chat`; the note (HTML) for the owner, if any. */
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
        ? `⚠️ ${bold("Library group saved, but I need")}\n${escape(missing.join(", "))}`
        : `✅ ${bold("Library group saved")}`;
    }
    if (state.chatId !== chat.id) return undefined;
    state.lastChatId = chat.id;
    delete state.chatId;
    await saveState(state, file);
    return `📚 ${bold("Removed from the library group")}\nResults come here again.`;
  });
}

library.on("my_chat_member", async (ctx) => {
  const { chat, new_chat_member: member } = ctx.myChatMember;
  const note = await memberChange(chat, member);
  if (note) await ctx.api.sendMessage(ownerId(), note, HTML);
});

library.command("publish", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  if ((await loadState()).chatId === undefined)
    return ctx.reply(
      `📚 ${bold("Set up the library group first")}\nPuts every book and song into the library group. Create a group, turn on Topics, and add me as admin with «Manage topics», «Delete messages» and «Pin messages». Then send /publish again.`,
      HTML,
    );
  const started = startJob(
    "publishing the library",
    () =>
      publish(
        ctx.api,
        liveStatus(
          async (text) => (await ctx.reply(text, HTML)).message_id,
          (messageId, text) =>
            ctx.api.editMessageText(ctx.chat.id, messageId, text, HTML),
        ),
      ),
    async (error) => {
      await ctx.reply(
        `⚠️ ${bold("Publishing failed")}\n${problem(error)}`,
        HTML,
      );
    },
  );
  if (!started) await ctx.reply(busyHtml(), HTML);
});
