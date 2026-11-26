import type { Api } from "grammy";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { syncSummaries } from "../library/summary.ts";
import { deliver, summary } from "./index.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));
vi.mock("../library/summary.ts", async (original) => ({
  ...(await original<typeof import("../library/summary.ts")>()),
  syncSummaries: vi.fn(),
}));
vi.mock("../video/info.ts", async (original) => ({
  ...(await original<typeof import("../video/info.ts")>()),
  videoInfo: vi.fn(async (id: string) =>
    id === "song0000000"
      ? { title: "S", categories: ["Music"], chapters: [] }
      : id === "unknown0000"
        ? undefined
        : { title: "L", categories: ["Education"], chapters: [] },
  ),
}));

describe("summary.actions", () => {
  it("offers the summary of a video that is not music, started at once", async () => {
    const actions = await summary.actions?.({
      kind: "youtube",
      id: "lecture0000",
    });
    expect(actions?.buttons).toEqual([
      { text: "📝 Summary", data: "summary:lecture0000" },
    ]);
    expect(actions?.ask).toBeTypeOf("function");
  });

  it("offers it when the category is unknown, and not for music or other links", async () => {
    expect(
      await summary.actions?.({ kind: "youtube", id: "unknown0000" }),
    ).toBeDefined();
    expect(
      await summary.actions?.({ kind: "youtube", id: "song0000000" }),
    ).toBeUndefined();
    expect(
      await summary.actions?.({ kind: "link", url: "https://a.b" }),
    ).toBeUndefined();
  });
});

describe("deliver", () => {
  async function described(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "summary-"));
    await mkdir(join(root, "lecture0000"));
    await writeFile(
      join(root, "lecture0000", "meta.json"),
      JSON.stringify({ title: "Lecture" }),
    );
    await writeFile(join(root, "lecture0000", "about.md"), "Про що.\n");
    await writeFile(join(root, "lecture0000", "brief.md"), "# Lecture\n");
    return root;
  }
  const fakeApi = () => ({
    sendMessage: vi.fn(async () => ({})),
    sendDocument: vi.fn(async () => ({})),
  });

  it("with a group sends «Done → link» to the level's message", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce({
      changed: [],
      link: (key) =>
        key === "lecture0000/brief" ? "https://t.me/c/1/2/3" : undefined,
    });
    const api = fakeApi();
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "brief",
      await described(),
    );
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "✅ <b>Done</b> → https://t.me/c/1/2/3",
      { parse_mode: "HTML" },
    );
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  it("without a group sends the description here, then a placeholder for each level not made", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce(undefined);
    const api = fakeApi();
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "about",
      await described(),
    );
    expect(api.sendMessage.mock.calls).toEqual([
      [
        5,
        "📝 <b>Lecture</b>\nhttps://youtu.be/lecture0000\n\nПро що.",
        expect.objectContaining({
          link_preview_options: expect.objectContaining({
            url: "https://i.ytimg.com/vi/lecture0000/maxresdefault.jpg",
          }),
        }),
      ],
      [
        5,
        "📖 <b>Detailed summary</b>",
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: [
              [
                {
                  text: "Make it",
                  callback_data: "summary:detailed:lecture0000",
                },
              ],
            ],
          }),
        }),
      ],
    ]);
  });

  it("without a group sends a level's .md here", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce(undefined);
    const api = fakeApi();
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "brief",
      await described(),
    );
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
