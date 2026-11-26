import { InputFile } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { FileItem, TextItem } from "./reconcile.ts";
import type { LibraryState } from "./state.ts";
import { MAX_UPLOAD } from "./topic.ts";
import * as fixtures from "./topic.testing.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

const { CHAT, apiError, audio, contents, posted, postedA, topicHarness } =
  fixtures;
const t = topicHarness();
const { sync } = t;

describe("syncTopic edge cases", () => {
  it("lists each changed key once when the topic is recreated midway", async () => {
    const a = audio("a");
    const state = postedA(a);
    t.api.sendAudio
      .mockImplementationOnce(() =>
        Promise.resolve({ message_id: 50, audio: { file_id: "fb" } }),
      )
      .mockRejectedValueOnce(apiError("Bad Request: message thread not found"));
    const result = await sync(state, [a, audio("b"), audio("c")]);
    expect(result.changed).toEqual(["b", "a", "c"]);
  });

  it("records a too-big file only after the owner was told", async () => {
    const state: LibraryState = { chatId: CHAT, topics: {} };
    const big = audio("big", { size: MAX_UPLOAD + 1 });
    t.api.sendMessage.mockImplementation((chat: unknown) =>
      chat === 7
        ? Promise.reject(new Error("network"))
        : Promise.resolve({ message_id: 1 }),
    );
    await expect(sync(state, [contents, big])).rejects.toThrow("network");
    expect(state.topics.book!.tooBig).toEqual({});
  });

  it("uploads again a file whose kind changed instead of reusing its file_id", async () => {
    const a = audio("a");
    const x = audio("x");
    const state: LibraryState = {
      chatId: CHAT,
      topics: {
        book: {
          threadId: 3,
          messages: [posted("a", 10, a), posted("x", 11, x)],
          tooBig: {},
        },
      },
    };
    const doc: FileItem = { ...x, kind: "document", file: "/books/x.epub" };
    await sync(state, [a, audio("b"), doc]);
    expect(t.api.sendDocument.mock.calls[0]![1]).toBeInstanceOf(InputFile);
  });

  it("sends a video and a document into the topic, and a text with its button", async () => {
    const state: LibraryState = { chatId: CHAT, topics: {} };
    const video: FileItem = {
      key: "v",
      kind: "video",
      file: "/k/v.mp4",
      size: 10,
      mtime: 1,
      caption: "Song",
      video: { duration: 3, width: 4, height: 5 },
    };
    const doc: FileItem = {
      key: "d",
      kind: "document",
      file: "/b/book.uk.epub",
      size: 10,
      mtime: 1,
      name: "Книга.epub",
    };
    const placeholder: TextItem = {
      key: "p",
      kind: "text",
      text: "⏳",
      button: { text: "Make", data: "make" },
    };
    await sync(state, [video, doc, placeholder]);

    expect(t.api.sendVideo.mock.calls[0]![2]).toEqual({
      message_thread_id: 5,
      caption: "Song",
      duration: 3,
      width: 4,
      height: 5,
      supports_streaming: true,
    });
    const upload = t.api.sendDocument.mock.calls[0]![1] as InputFile;
    expect(upload.filename).toBe("Книга.epub");
    expect(t.api.sendMessage.mock.calls.at(-1)![2]).toMatchObject({
      message_thread_id: 5,
      reply_markup: {
        inline_keyboard: [[{ text: "Make", callback_data: "make" }]],
      },
    });
  });
});
