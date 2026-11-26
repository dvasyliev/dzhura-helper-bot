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
import {
  reconcile,
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
};

/** A link to a message inside a forum topic. */
export function messageLink(
  chatId: number,
  threadId: number,
  messageId: number,
): string {
  const id = String(chatId).replace(/^-100/, "");
  return `https://t.me/c/${id}/${threadId}/${messageId}`;
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

function keyboard(item: TextItem): InlineKeyboard | undefined {
  return item.button
    ? new InlineKeyboard().text(item.button.text, item.button.data)
    : undefined;
}

function mediaOptions(item: FileItem) {
  return {
    ...(item.caption === undefined ? {} : { caption: item.caption }),
    ...(item.kind === "audio"
      ? { title: item.title, performer: item.performer }
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
    message.video?.file_id
  );
}

function upload(item: FileItem): InputFile {
  return new InputFile(item.file, item.name ?? path.basename(item.file));
}

/**
 * Makes topic `key` (created as `name` when missing) hold `items`; mutates and saves `state`. With `probe` an existing
 * topic is first checked by renaming it to `name`, so one deleted by hand is created again even when nothing changed.
 */
export async function syncTopic(
  api: Api,
  state: LibraryState,
  key: string,
  name: string,
  items: Item[],
  file = LIBRARY_FILE,
  { probe = false }: { probe?: boolean } = {},
): Promise<Synced> {
  const chatId = state.chatId;
  if (chatId === undefined) throw new Error("The library group is not set");
  const save = () => saveState(state, file);

  const createTopic = async (): Promise<Topic> => {
    const created = await api.createForumTopic(chatId, name);
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
      await api.editForumTopic(chatId, topic.threadId, { name });
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
    topic.tooBig[item.key] = version(item);
    await save();
    await api.sendMessage(
      config.ownerId,
      `Too big for Telegram (over 50 MB), not posted: ${item.file}`,
    );
  }

  const changed: string[] = [];
  const reconciled = reconcile(wanted, topic.messages);
  let cut = reconciled.cut;

  const editOne = async (item: Item, old: Posted): Promise<void> => {
    let fileId: string | undefined;
    if (item.kind === "text" && old.kind === "text") {
      await api.editMessageText(chatId, old.messageId, item.text, {
        reply_markup: keyboard(item),
      });
    } else if (item.kind === "text") {
      await api.editMessageCaption(chatId, old.messageId, {
        caption: item.text,
        reply_markup: keyboard(item),
      });
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
    old.version = version(item);
    if (fileId) old.fileId = fileId;
    else delete old.fileId;
  };

  for (const i of reconciled.edit) {
    const item = wanted[i]!;
    const old = topic.messages[i]!;
    try {
      await editOne(item, old);
      changed.push(item.key);
    } catch (error) {
      if (!apiError(error, "message is not modified")) {
        cut = i;
        break;
      }
      old.version = version(item);
    }
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
        ...thread,
        reply_markup: keyboard(item),
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
    const reused = [...removed, ...lost].find(
      (m) => m.key === item.key && m.version === version(item) && m.fileId,
    )?.fileId;
    const input = reused ?? upload(item);
    const options = { ...thread, ...mediaOptions(item) };
    const sent =
      item.kind === "audio"
        ? await api.sendAudio(chatId, input, options)
        : item.kind === "video"
          ? await api.sendVideo(chatId, input, options)
          : await api.sendDocument(chatId, input, options);
    const fileId = fileIdOf(sent);
    return {
      key: item.key,
      messageId: sent.message_id,
      kind: item.kind,
      version: version(item),
      ...(fileId ? { fileId } : {}),
    };
  };

  const sendFrom = async (start: number): Promise<void> => {
    for (const item of wanted.slice(start)) {
      topic.messages.push(await sendOne(item));
      changed.push(item.key);
      await save();
    }
  };

  try {
    await sendFrom(cut);
  } catch (error) {
    if (!topicGone(error)) throw error;
    lost.push(...topic.messages);
    topic = await createTopic();
    await sendFrom(0);
  }

  return {
    changed,
    link: (wantedKey) => {
      const message = topic.messages.find((m) => m.key === wantedKey);
      return message && messageLink(chatId, topic.threadId, message.messageId);
    },
  };
}
