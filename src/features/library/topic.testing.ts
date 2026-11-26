import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrammyError, type Api } from "grammy";
import { beforeEach, vi } from "vitest";
import {
  version,
  type FileItem,
  type Item,
  type TextItem,
} from "./reconcile.ts";
import type { LibraryState } from "./state.ts";
import { syncTopic, type SyncOptions } from "./topic.ts";

export const CHAT = -1001234567890;

export function apiError(description: string): GrammyError {
  return new GrammyError(
    description,
    { ok: false, error_code: 400, description },
    "method",
    {},
  );
}

function fakeApi() {
  let n = 100;
  let thread = 5;
  const file =
    (field: string) =>
    (..._args: unknown[]) => {
      const id = n++;
      return Promise.resolve({
        message_id: id,
        [field]: { file_id: `f${id}` },
      });
    };
  return {
    createForumTopic: vi.fn(() =>
      Promise.resolve({ message_thread_id: thread++ }),
    ),
    sendMessage: vi.fn((..._args: unknown[]) =>
      Promise.resolve({ message_id: n++ }),
    ),
    sendAudio: vi.fn(file("audio")),
    sendDocument: vi.fn(file("document")),
    sendVideo: vi.fn(file("video")),
    sendPhoto: vi.fn((..._args: unknown[]) => {
      const id = n++;
      return Promise.resolve({
        message_id: id,
        photo: [{ file_id: `s${id}` }, { file_id: `f${id}` }],
      });
    }),
    sendMediaGroup: vi.fn(),
    editMessageText: vi.fn(() => Promise.resolve(true)),
    editMessageMedia: vi.fn(() =>
      Promise.resolve({ message_id: 1, audio: { file_id: "edited" } }),
    ),
    editMessageCaption: vi.fn(() => Promise.resolve(true)),
    deleteMessage: vi.fn(() => Promise.resolve(true)),
    pinChatMessage: vi.fn(() => Promise.resolve(true)),
    editForumTopic: vi.fn(() => Promise.resolve(true)),
  };
}

export function audio(key: string, extra: Partial<FileItem> = {}): FileItem {
  return {
    key,
    kind: "audio",
    file: `/books/${key}.mp3`,
    size: 1000,
    mtime: 1,
    title: key,
    ...extra,
  };
}

export const contents: TextItem = {
  key: "contents",
  kind: "text",
  text: "Contents",
  pin: true,
};

export function posted(key: string, messageId: number, item: Item) {
  return {
    key,
    messageId,
    kind: item.kind,
    version: version(item),
    ...(item.kind === "text" ? {} : { fileId: `f-${key}` }),
    ...(item.kind === "audio" ? { alone: true } : {}),
  };
}

/** Topic 3 holding audio `a` as message 10. */
export function postedA(a: FileItem): LibraryState {
  return {
    chatId: CHAT,
    topics: {
      book: { threadId: 3, messages: [posted("a", 10, a)], tooBig: {} },
    },
  };
}

/** Topic 5 holding `item` as message 10, under its own key. */
export function postedState(item: Item): LibraryState {
  return {
    chatId: CHAT,
    topics: {
      book: {
        threadId: 5,
        messages: [posted(item.key, 10, item)],
        tooBig: {},
      },
    },
  };
}

/** A fresh fake API and state file per test, and `sync` into topic "book" with them. */
export function topicHarness() {
  const t = {
    file: "",
    api: fakeApi(),
    sync: (state: LibraryState, items: Item[], options: SyncOptions = {}) =>
      syncTopic(
        t.api as unknown as Api,
        state,
        "book",
        "Author — Title",
        items,
        t.file,
        options,
      ),
  };
  beforeEach(async () => {
    t.file = join(await mkdtemp(join(tmpdir(), "library-")), "library.json");
    t.api = fakeApi();
  });
  return t;
}
