import { InputFile } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "./reconcile.ts";
import type { LibraryState } from "./state.ts";
import {
  audio,
  CHAT,
  contents,
  postedA,
  postedState,
  topicHarness,
} from "./topic.testing.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

const t = topicHarness();
const { sync } = t;

function cover(caption: string, mtime = 1): FileItem {
  return {
    key: "contents",
    kind: "photo",
    file: "/books/cover.jpg",
    size: 500,
    mtime,
    caption,
    pin: true,
  };
}

describe("a cover as the pinned contents", () => {
  it("is sent as a photo with its caption and pinned", async () => {
    const state: LibraryState = { chatId: CHAT, topics: {} };
    await sync(state, [cover("Card")]);
    expect(t.api.sendPhoto).toHaveBeenCalledWith(
      CHAT,
      expect.any(InputFile),
      expect.objectContaining({
        caption: "Card",
        parse_mode: "HTML",
        message_thread_id: 5,
      }),
    );
    expect(t.api.pinChatMessage).toHaveBeenCalledWith(CHAT, 100, {
      disable_notification: true,
    });
    expect(state.topics.book!.messages[0]).toMatchObject({
      kind: "photo",
      fileId: "f100",
    });
  });

  it("changes only its caption with editMessageCaption", async () => {
    const old = cover("Old");
    const state = postedState(old);
    await sync(state, [cover("New")]);
    expect(t.api.editMessageCaption).toHaveBeenCalledWith(CHAT, 10, {
      parse_mode: "HTML",
      caption: "New",
    });
    expect(t.api.editMessageMedia).not.toHaveBeenCalled();
  });

  it("is replaced with editMessageMedia when the picture changed", async () => {
    const old = cover("Same");
    const state = postedState(old);
    await sync(state, [cover("Same", 2)]);
    expect(t.api.editMessageMedia).toHaveBeenCalledWith(
      CHAT,
      10,
      expect.objectContaining({ type: "photo", caption: "Same" }),
    );
  });

  it("replaces a text contents message, which cannot become a photo", async () => {
    const state = postedState(contents);
    await sync(state, [cover("Card")]);
    expect(t.api.deleteMessage).toHaveBeenCalledWith(CHAT, 10);
    expect(t.api.sendPhoto).toHaveBeenCalledTimes(1);
    expect(t.api.pinChatMessage).toHaveBeenCalledTimes(1);
  });
});

describe("an audio whose description arrived", () => {
  it("gets its caption by editMessageCaption, without uploading again", async () => {
    const state = postedA(audio("a"));
    await sync(state, [audio("a", { caption: "Про море" })]);
    expect(t.api.editMessageCaption).toHaveBeenCalledWith(CHAT, 10, {
      parse_mode: "HTML",
      caption: "Про море",
    });
    expect(t.api.editMessageMedia).not.toHaveBeenCalled();
    expect(t.api.sendAudio).not.toHaveBeenCalled();
    expect(state.topics.book!.messages[0]).toMatchObject({ fileId: "f-a" });
  });
});
