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
    const dir = join(root, "Lecture");
    await mkdir(dir);
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify({ id: "lecture0000", title: "Lecture" }),
    );
    await writeFile(join(dir, "about.md"), "Про що.\n");
    await writeFile(join(dir, "brief.md"), "# Lecture\n");
    return root;
  }
  const fakeApi = () => ({
    sendMessage: vi.fn(async () => ({})),
    sendDocument: vi.fn(async () => ({})),
    sendAudio: vi.fn(async () => ({})),
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

  it("without a group sends the description here, then each level's heading and the places not filled yet", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce(undefined);
    const api = fakeApi();
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "about",
      await described(),
    );
    const calls = api.sendMessage.mock.calls as unknown as [
      number,
      string,
      { reply_markup?: { inline_keyboard: { callback_data: string }[][] } },
    ][];
    expect(calls.map((c) => c[1])).toEqual([
      "📝 <b>Lecture</b>\nhttps://youtu.be/lecture0000\n\nПро що.",
      "📋 <b>Brief summary</b>",
      "No audio yet",
      "📖 <b>Detailed summary</b>",
      "No document yet",
      "No audio yet",
    ]);
    expect(calls[4]![2].reply_markup?.inline_keyboard).toEqual([
      [{ text: "✨ Generate", callback_data: "summary:detailed:lecture0000" }],
    ]);
  });

  it("without a group sends a level's audio here once voiced", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce(undefined);
    const api = fakeApi();
    const root = await described();
    await writeFile(join(root, "Lecture", "brief - Oksana.mp3"), "abc");
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "brief",
      root,
      "audio",
    );
    expect(api.sendAudio).toHaveBeenCalledTimes(1);
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  it("with a group sends «Done → link» to the level's audio", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce({
      changed: [],
      link: (key) =>
        key === "lecture0000/brief/audio" ? "https://t.me/c/1/2/4" : undefined,
    });
    const api = fakeApi();
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "brief",
      await described(),
      "audio",
    );
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "✅ <b>Done</b> → https://t.me/c/1/2/4",
      { parse_mode: "HTML" },
    );
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
