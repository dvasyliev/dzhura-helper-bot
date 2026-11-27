import { describe, expect, it, vi } from "vitest";
import type { FileItem, TextItem } from "../reconcile.ts";
import { CHAT, postedState, topicHarness } from "./topic.testing.ts";

vi.mock("../../telegram/owner.ts", () => ({ ownerId: () => 7 }));

const t = topicHarness();
const { sync } = t;

describe("syncTopic text messages", () => {
  it("shows a text's preview large above it, and edits it in when added", async () => {
    const plain: TextItem = { key: "v", kind: "text", text: "Video" };
    const shown = { ...plain, preview: "https://i.ytimg.com/vi/x/a.jpg" };
    const preview = {
      link_preview_options: {
        url: "https://i.ytimg.com/vi/x/a.jpg",
        prefer_large_media: true,
        show_above_text: true,
      },
    };
    await sync({ chatId: CHAT, topics: {} }, [shown]);
    expect(t.api.sendMessage).toHaveBeenCalledWith(
      CHAT,
      "Video",
      expect.objectContaining(preview),
    );

    await sync(postedState(plain), [shown]);
    expect(t.api.editMessageText).toHaveBeenCalledWith(
      CHAT,
      10,
      "Video",
      expect.objectContaining(preview),
    );
  });

  it("text to a document puts the file in the same message", async () => {
    const placeholder: TextItem = { key: "x", kind: "text", text: "⏳ X" };
    const doc: FileItem = {
      key: "x",
      kind: "document",
      file: "/s/x.md",
      size: 1,
      mtime: 1,
    };
    t.api.editMessageMedia.mockResolvedValueOnce({
      message_id: 10,
      document: { file_id: "d" },
    } as never);
    const state = postedState(placeholder);
    await sync(state, [doc]);

    expect(t.api.editMessageMedia).toHaveBeenCalledWith(
      CHAT,
      10,
      expect.objectContaining({ type: "document" }),
    );
    expect(t.api.sendDocument).not.toHaveBeenCalled();
    expect(state.topics.book!.messages[0]).toMatchObject({
      kind: "document",
      fileId: "d",
    });
  });
});
