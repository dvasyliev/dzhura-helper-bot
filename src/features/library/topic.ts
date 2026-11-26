import path from "node:path";
import {
  GrammyError,
  InlineKeyboard,
  InputFile,
  InputMediaBuilder,
  type Api,
} from "grammy";
import type { Message } from "grammy/types";
import { config } from "../../config.ts";
import { bold, code, escape, HTML } from "../../format.ts";
import {
  reconcile,
  fileVersion,
  version,
  type FileItem,
  type Item,
  type Posted,
  type TextItem,
} from "./reconcile.ts";
import {
  LIBRARY_FILE,
  saveState,
  type LibraryState,
  type Topic,
} from "./state.ts";

/** Telegram's upload limit for bots. */
export const MAX_UPLOAD = 50 * 1024 * 1024;

export type Synced = {
  changed: string[];
  link: (key: string) => string | undefined;
  /** The topic's own link. */
  topic?: string;
};

/** `probe`: see syncTopic. `progress`: told the messages sent or edited so far, of all to send or edit. */
export type SyncOptions = {
  probe?: boolean;
  progress?: (done: number, total: number) => void;
};

/** A link to a forum topic. */
function topicLink(chatId: number, threadId: number): string {
  const id = String(chatId).replace(/^-100/, "");
  return `https://t.me/c/${id}/${threadId}`;
}

/** A link to a message inside a forum topic. */
export function messageLink(
  chatId: number,
  threadId: number,
  messageId: number,
): string {
  return `${topicLink(chatId, threadId)}/${messageId}`;
}

function apiError(error: unknown, text: string): boolean {
  return error instanceof GrammyError && error.description.includes(text);
}

/** The topic was deleted by hand, or never existed. */
function topicGone(error: unknown): boolean {
  return (
    apiError(error, "message thread not found") ||
    apiError(error, "TOPIC_DELETED") ||
    apiError(error, "TOPIC_ID_INVALID")
  );
}

/** The row of buttons under a text item, if any. */
function keyboard(item: TextItem): InlineKeyboard | undefined {
  return item.buttons?.length
    ? InlineKeyboard.from([
        item.buttons.map((b) => InlineKeyboard.text(b.text, b.data)),
      ])
    : undefined;
}

/** Send and edit options of a text item: HTML, its buttons and its preview. */
export function textOptions(item: TextItem) {
  return {
    ...HTML,
    reply_markup: keyboard(item),
    ...(item.preview
      ? {
          link_preview_options: {
            url: item.preview,
            prefer_large_media: true,
            show_above_text: true,
          },
        }
      : {}),
  };
}

function mediaOptions(item: FileItem) {
  return {
    ...(item.caption === undefined ? {} : { ...HTML, caption: item.caption }),
    ...(item.kind === "audio"
      ? { title: item.title, performer: item.performer }
      : {}),
    ...(item.kind === "audio" && item.thumbnail
      ? { thumbnail: new InputFile(item.thumbnail) }
      : {}),
    ...(item.kind === "video" && item.video
      ? { ...item.video, supports_streaming: true }
      : {}),
  };
}

function fileIdOf(message: Message | true): string | undefined {
  if (message === true) return undefined;
  return (
    message.audio?.file_id ??
    message.document?.file_id ??
    message.photo?.at(-1)?.file_id ??
    message.video?.file_id
  );
}

function postedFile(item: FileItem, sent: Message): Posted {
  const fileId = fileIdOf(sent);
  return {
    key: item.key,
    messageId: sent.message_id,
    kind: item.kind,
    version: version(item),
    ...(fileId ? { fileId } : {}),
    ...(item.kind === "audio" ? { alone: true } : {}),
  };
}

/** Whether the posted message holds this item's file and audio title, only its caption may differ. */
function sameFile(item: FileItem, old: Posted): boolean {
  return old.version.startsWith(fileVersion(item));
}

function upload(item: FileItem): InputFile {
  return new InputFile(item.file, item.name ?? path.basename(item.file));
}

/** Topic icons: custom emoji ids from getForumTopicIconStickers, the only ones a topic can have. */
export const TOPIC_ICONS = {
  book: "5350481781306958339", // 📚
  karaoke: "5382003830487523366", // 🎤
  summary: "5373251851074415873", // 📝
};

/**
 * Makes topic `key` (created as `name` with `icon` when missing) hold `items`; mutates and saves `state`. With `probe` an existing
 * topic is first checked by renaming it to `name` and `icon`, so one deleted by hand is created again even when nothing changed.
 */
export async function syncTopic(
  api: Api,
  state: LibraryState,
  key: string,
  { name, icon }: { name: string; icon: string },
  items: Item[],
  file = LIBRARY_FILE,
  { probe = false, progress }: SyncOptions = {},
): Promise<Synced> {
  const chatId = state.chatId;
  if (chatId === undefined) throw new Error("The library group is not set");
  const save = () => saveState(state, file);

  const createTopic = async (): Promise<Topic> => {
    const created = await api.createForumTopic(chatId, name, {
      icon_custom_emoji_id: icon,
    });
    const topic: Topic = {
      threadId: created.message_thread_id,
      messages: [],
      tooBig: state.topics[key]?.tooBig ?? {},
    };
    state.topics[key] = topic;
    await save();
    return topic;
  };

  /** Messages of a lost topic: sent again by file_id. */
  const lost: Posted[] = [];
  const existing = state.topics[key];
  let topic = existing ?? (await createTopic());
  if (probe && existing) {
    try {
      await api.editForumTopic(chatId, topic.threadId, {
        name,
        icon_custom_emoji_id: icon,
      });
    } catch (error) {
      if (topicGone(error)) {
        lost.push(...topic.messages);
        topic = await createTopic();
      } else if (
        !apiError(error, "not modified") &&
        !apiError(error, "NOT_MODIFIED")
      )
        throw error;
    }
  }

  const wanted: Item[] = [];
  for (const item of items) {
    if (item.kind === "text" || item.size <= MAX_UPLOAD) {
      wanted.push(item);
      continue;
    }
    if (topic.tooBig[item.key] === version(item)) continue;
    // Recorded only once the owner was told, so a failed note is sent again next time.
    await api.sendMessage(
      config.ownerId,
      `⚠️ ${bold("Too big for Telegram")}\nOver 50 MB, not posted: ${code(escape(item.file))}`,
      HTML,
    );
    topic.tooBig[item.key] = version(item);
    await save();
  }

  const changed: string[] = [];
  const reconciled = reconcile(wanted, topic.messages);
  let cut = reconciled.cut;

  const editOne = async (item: Item, old: Posted): Promise<void> => {
    let fileId: string | undefined;
    if (item.kind === "text" && old.kind === "text") {
      await api.editMessageText(
        chatId,
        old.messageId,
        item.text,
        textOptions(item),
      );
    } else if (item.kind === "text") {
      await api.editMessageCaption(chatId, old.messageId, {
        ...HTML,
        caption: item.text,
        reply_markup: keyboard(item),
      });
    } else if (old.kind === item.kind && sameFile(item, old)) {
      // Only the caption changed: the file is not uploaded again, and its file_id stays.
      await api.editMessageCaption(chatId, old.messageId, {
        ...HTML,
        caption: item.caption,
      });
      fileId = old.fileId;
    } else {
      const media = InputMediaBuilder[item.kind](
        upload(item),
        mediaOptions(item),
      );
      fileId = fileIdOf(
        await api.editMessageMedia(chatId, old.messageId, media),
      );
    }
    // A caption edit leaves a media message: it keeps its kind.
    old.kind = item.kind === "text" ? old.kind : item.kind;
    // An audio edited into a message stands alone: it is in no album.
    if (item.kind === "audio") old.alone = true;
    old.version = version(item);
    if (fileId) old.fileId = fileId;
    else delete old.fileId;
  };

  let done = 0;
  let total = reconciled.edit.length + wanted.length - reconciled.cut;
  const step = () => progress?.(++done, total);

  for (const i of reconciled.edit) {
    const item = wanted[i]!;
    const old = topic.messages[i]!;
    try {
      await editOne(item, old);
      changed.push(item.key);
    } catch (error) {
      if (!apiError(error, "message is not modified")) {
        cut = i;
        total = done + wanted.length - cut;
        break;
      }
      old.version = version(item);
    }
    step();
    await save();
  }

  const removed = topic.messages.slice(cut);
  topic.messages = topic.messages.slice(0, cut);
  for (const message of removed) {
    await api.deleteMessage(chatId, message.messageId).catch(() => undefined);
  }
  await save();

  const sendOne = async (item: Item): Promise<Posted> => {
    const thread = { message_thread_id: topic.threadId };
    if (item.kind === "text") {
      const sent = await api.sendMessage(chatId, item.text, {
        ...textOptions(item),
        ...thread,
      });
      if (item.pin)
        await api.pinChatMessage(chatId, sent.message_id, {
          disable_notification: true,
        });
      return {
        key: item.key,
        messageId: sent.message_id,
        kind: "text",
        version: version(item),
      };
    }
    const input = inputOf(item);
    const options = { ...thread, ...mediaOptions(item) };
    const sent =
      item.kind === "audio"
        ? await api.sendAudio(chatId, input, options)
        : item.kind === "video"
          ? await api.sendVideo(chatId, input, options)
          : item.kind === "photo"
            ? await api.sendPhoto(chatId, input, options)
            : await api.sendDocument(chatId, input, options);
    if (item.pin)
      await api.pinChatMessage(chatId, sent.message_id, {
        disable_notification: true,
      });
    return postedFile(item, sent);
  };

  /** A file sent before with the same content (its caption may differ), by its file id, so it is not uploaded again. */
  const inputOf = (item: FileItem): InputFile | string =>
    [...removed, ...lost].find(
      (m) =>
        m.key === item.key &&
        m.kind === item.kind &&
        sameFile(item, m) &&
        m.fileId,
    )?.fileId ?? upload(item);

  // One message per file, so each audio can be reacted to and forwarded alone.
  const sendFrom = async (start: number): Promise<void> => {
    for (const item of wanted.slice(start)) {
      const message = await sendOne(item);
      step();
      topic.messages.push(message);
      changed.push(message.key);
      await save();
    }
  };

  try {
    await sendFrom(cut);
  } catch (error) {
    if (!topicGone(error)) throw error;
    lost.push(...topic.messages);
    topic = await createTopic();
    total = done + wanted.length;
    await sendFrom(0);
  }

  return {
    // A recreated topic sends again keys already sent before it was lost.
    changed: [...new Set(changed)],
    topic: topicLink(chatId, topic.threadId),
    link: (wantedKey) => {
      const message = topic.messages.find((m) => m.key === wantedKey);
      return message && messageLink(chatId, topic.threadId, message.messageId);
    },
  };
}
