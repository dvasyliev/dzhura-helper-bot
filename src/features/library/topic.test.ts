import { InputFile } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { version, type TextItem } from "./reconcile.ts";
import { loadState, type LibraryState } from "./state.ts";
import { MAX_UPLOAD, messageLink } from "./topic.ts";
import {
  CHAT,
  apiError,
  audio,
  contents,
  posted,
  postedA,
  topicHarness,
} from "./topic.testing.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

const t = topicHarness();
const { sync } = t;

/** Message 11 was deleted and two audios sent again: the first uploaded, the second by its file id. */
function expectResent(secondFileId: string) {
  expect(t.api.deleteMessage).toHaveBeenCalledWith(CHAT, 11);
  expect(t.api.sendAudio).toHaveBeenCalledTimes(2);
  expect(t.api.sendAudio.mock.calls[0]![1]).toBeInstanceOf(InputFile);
  expect(t.api.sendAudio.mock.calls[1]![1]).toBe(secondFileId);
}

describe("syncTopic", () => {
  it("creates the topic and sends every item, pinning the contents", async () => {
    const state: LibraryState = { chatId: CHAT, topics: {} };
    const result = await sync(state, [contents, audio("a")]);

    expect(t.api.createForumTopic).toHaveBeenCalledWith(CHAT, "Author — Title");
    expect(t.api.sendMessage).toHaveBeenCalledWith(
      CHAT,
      "Contents",
      expect.objectContaining({ message_thread_id: 5 }),
    );
    expect(t.api.pinChatMessage).toHaveBeenCalledWith(CHAT, 100, {
      disable_notification: true,
    });
    const [, input, options] = t.api.sendAudio.mock.calls[0] as unknown as [
      number,
      InputFile,
      Record<string, unknown>,
    ];
    expect(input).toBeInstanceOf(InputFile);
    expect(options).toMatchObject({
      message_thread_id: 5,
      title: "a",
      performer: "Book",
    });
    expect(result.changed).toEqual(["contents", "a"]);
    expect(result.link("a")).toBe("https://t.me/c/1234567890/5/101");
    expect(result.link("missing")).toBeUndefined();
    expect(state.topics.book!.messages).toEqual([
      {
        key: "contents",
        messageId: 100,
        kind: "text",
        version: version(contents),
      },
      {
        key: "a",
        messageId: 101,
        kind: "audio",
        version: version(audio("a")),
        fileId: "f101",
      },
    ]);
    expect(await loadState(t.file)).toEqual(state);
  });

  it("edits a changed audio with editMessageMedia", async () => {
    const old = audio("a");
    const state: LibraryState = {
      chatId: CHAT,
      topics: {
        book: { threadId: 5, messages: [posted("a", 10, old)], tooBig: {} },
      },
    };
    const changed = audio("a", { mtime: 2 });
    const result = await sync(state, [changed]);

    expect(t.api.editMessageMedia).toHaveBeenCalledWith(
      CHAT,
      10,
      expect.objectContaining({ type: "audio", title: "a", performer: "Book" }),
    );
    expect(t.api.sendAudio).not.toHaveBeenCalled();
    expect(result.changed).toEqual(["a"]);
    expect(state.topics.book!.messages[0]).toMatchObject({
      messageId: 10,
      version: version(changed),
      fileId: "edited",
    });
  });

  it("re-sends the tail by file_id", async () => {
    const a = audio("a");
    const c = audio("c");
    const state: LibraryState = {
      chatId: CHAT,
      topics: {
        book: {
          threadId: 5,
          messages: [posted("a", 10, a), posted("c", 11, c)],
          tooBig: {},
        },
      },
    };
    const result = await sync(state, [a, audio("b"), c]);

    expectResent("f-c");
    expect(result.changed).toEqual(["b", "c"]);
    expect(state.topics.book!.messages.map((m) => m.key)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("media to text edits the caption", async () => {
    const state: LibraryState = {
      chatId: CHAT,
      topics: {
        book: {
          threadId: 5,
          messages: [posted("x", 10, audio("x"))],
          tooBig: {},
        },
      },
    };
    const text: TextItem = { key: "x", kind: "text", text: "Now text" };
    const result = await sync(state, [text]);

    expect(t.api.editMessageCaption).toHaveBeenCalledWith(
      CHAT,
      10,
      expect.objectContaining({ caption: "Now text" }),
    );
    expect(result.changed).toEqual(["x"]);
    expect(state.topics.book!.messages[0]!.version).toBe(version(text));
  });

  it("treats a message that can no longer be edited as missing", async () => {
    const a = audio("a");
    const b = audio("b");
    const state: LibraryState = {
      chatId: CHAT,
      topics: {
        book: {
          threadId: 5,
          messages: [posted("a", 10, a), posted("b", 11, b)],
          tooBig: {},
        },
      },
    };
    t.api.editMessageMedia.mockRejectedValueOnce(
      apiError("Bad Request: message to edit not found"),
    );
    const result = await sync(state, [audio("a", { mtime: 2 }), b]);

    expect(t.api.deleteMessage).toHaveBeenCalledWith(CHAT, 10);
    expectResent("f-b");
    expect(result.changed).toEqual(["a", "b"]);
  });

  it("ignores an edit that changes nothing", async () => {
    const state: LibraryState = {
      chatId: CHAT,
      topics: {
        book: {
          threadId: 5,
          messages: [posted("contents", 10, contents)],
          tooBig: {},
        },
      },
    };
    t.api.editMessageText.mockRejectedValueOnce(
      apiError("Bad Request: message is not modified"),
    );
    const result = await sync(state, [{ ...contents, text: "New" }]);

    expect(t.api.sendMessage).not.toHaveBeenCalled();
    expect(t.api.deleteMessage).not.toHaveBeenCalled();
    expect(result.changed).toEqual([]);
  });

  it("recreates a deleted topic", async () => {
    const a = audio("a");
    const state = postedA(a);
    t.api.sendAudio.mockRejectedValueOnce(
      apiError("Bad Request: message thread not found"),
    );
    const result = await sync(state, [a, audio("b")]);

    expect(t.api.createForumTopic).toHaveBeenCalledWith(CHAT, "Author — Title");
    expect(state.topics.book!.threadId).toBe(5);
    expect(t.api.sendAudio.mock.calls.at(-2)![1]).toBe("f-a");
    expect(t.api.sendAudio.mock.calls.at(-1)![2]).toMatchObject({
      message_thread_id: 5,
    });
    expect(result.changed).toEqual(["a", "b"]);
    expect(state.topics.book!.messages.map((m) => m.key)).toEqual(["a", "b"]);
  });

  it.each(["TOPIC_DELETED", "TOPIC_ID_INVALID"])(
    "recreates a topic gone with %s while sending",
    async (text) => {
      const a = audio("a");
      const state = postedA(a);
      t.api.sendAudio.mockRejectedValueOnce(apiError(`Bad Request: ${text}`));
      await sync(state, [a, audio("b")]);
      expect(state.topics.book!.threadId).toBe(5);
    },
  );

  it("probe: leaves an existing, unchanged topic alone", async () => {
    const a = audio("a");
    const state = postedA(a);
    t.api.editForumTopic.mockRejectedValueOnce(
      apiError("Bad Request: TOPIC_NOT_MODIFIED"),
    );
    const result = await sync(state, [a], true);

    expect(t.api.editForumTopic).toHaveBeenCalledWith(CHAT, 3, {
      name: "Author — Title",
    });
    expect(t.api.createForumTopic).not.toHaveBeenCalled();
    expect(t.api.sendAudio).not.toHaveBeenCalled();
    expect(result.changed).toEqual([]);
  });

  it.each(["message thread not found", "TOPIC_DELETED", "TOPIC_ID_INVALID"])(
    "probe: recreates a topic deleted by hand (%s) and sends everything",
    async (text) => {
      const a = audio("a");
      const state = postedA(a);
      t.api.editForumTopic.mockRejectedValueOnce(
        apiError(`Bad Request: ${text}`),
      );
      const result = await sync(state, [a], true);

      expect(t.api.createForumTopic).toHaveBeenCalledWith(
        CHAT,
        "Author — Title",
      );
      expect(state.topics.book!.threadId).toBe(5);
      expect(t.api.sendAudio).toHaveBeenCalledTimes(1);
      expect(t.api.sendAudio.mock.calls[0]![1]).toBe("f-a");
      expect(t.api.sendAudio.mock.calls[0]![2]).toMatchObject({
        message_thread_id: 5,
      });
      expect(result.changed).toEqual(["a"]);
    },
  );

  it("does not probe without the option", async () => {
    const a = audio("a");
    const state = postedA(a);
    await sync(state, [a]);
    expect(t.api.editForumTopic).not.toHaveBeenCalled();
  });

  it("throws when the recreated topic is missing too", async () => {
    const state: LibraryState = { chatId: CHAT, topics: {} };
    t.api.sendAudio.mockRejectedValue(
      apiError("Bad Request: message thread not found"),
    );
    await expect(sync(state, [audio("a")])).rejects.toThrow(
      "message thread not found",
    );
  });

  it("skips a file over 50 MB and tells the owner once", async () => {
    const state: LibraryState = { chatId: CHAT, topics: {} };
    const big = audio("big", { size: MAX_UPLOAD + 1 });
    await sync(state, [contents, big]);
    await sync(state, [contents, big]);

    expect(t.api.sendAudio).not.toHaveBeenCalled();
    const notes = t.api.sendMessage.mock.calls.filter(
      (call) => (call as unknown[])[0] === 7,
    );
    expect(notes).toEqual([
      [7, "Too big for Telegram (over 50 MB), not posted: /books/big.mp3"],
    ]);
    expect(state.topics.book!.tooBig).toEqual({ big: version(big) });
  });

  it("needs the group's chat id", async () => {
    await expect(sync({ topics: {} }, [contents])).rejects.toThrow();
  });
});

describe("messageLink", () => {
  it("links a message in a topic", () => {
    expect(messageLink(-1001234567890, 5, 42)).toBe(
      "https://t.me/c/1234567890/5/42",
    );
  });
});
