import { describe, expect, it, vi } from "vitest";
import { CHAT, audio, postedState, topicHarness } from "./topic.testing.ts";

vi.mock("../../telegram/owner.ts", () => ({ ownerId: () => 7 }));

const t = topicHarness();
const { sync } = t;

const markup = (text: string, data: string) => ({
  reply_markup: { inline_keyboard: [[{ text, callback_data: data }]] },
});

describe("syncTopic file buttons", () => {
  it("sends a file with its row of buttons", async () => {
    await sync({ chatId: CHAT, topics: {} }, [
      audio("a", { buttons: [{ text: "🎙 Voice", data: "v" }] }),
    ]);
    expect(t.api.sendAudio).toHaveBeenCalledWith(
      CHAT,
      expect.anything(),
      expect.objectContaining(markup("🎙 Voice", "v")),
    );
  });

  it("edits only the caption and buttons when the buttons change, keeping the file", async () => {
    const state = postedState(audio("a"));
    const result = await sync(state, [
      audio("a", { buttons: [{ text: "🔁 EN", data: "l" }] }),
    ]);
    expect(t.api.editMessageMedia).not.toHaveBeenCalled();
    expect(t.api.editMessageCaption).toHaveBeenCalledWith(
      CHAT,
      10,
      expect.objectContaining(markup("🔁 EN", "l")),
    );
    expect(result.changed).toEqual(["a"]);
  });

  it("keeps the buttons when the file itself is replaced", async () => {
    const state = postedState(audio("a"));
    await sync(state, [
      audio("a", { mtime: 2, buttons: [{ text: "🎙 Voice", data: "v" }] }),
    ]);
    expect(t.api.editMessageMedia).toHaveBeenCalledWith(
      CHAT,
      10,
      expect.objectContaining({ type: "audio" }),
      markup("🎙 Voice", "v"),
    );
  });
});
