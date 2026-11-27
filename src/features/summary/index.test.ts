import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  findVideo,
  setMaking,
  summaryItems,
  syncSummaries,
} from "../../lib/library/summary.ts";
import { startJob } from "../../lib/jobs/jobs.ts";
import { pressButton } from "../../lib/telegram/press.testing.ts";
import { summary } from "./index.ts";

vi.mock("../../lib/telegram/owner.ts", () => ({ ownerId: () => 7 }));
vi.mock("../../lib/library/summary.ts", async (original) => {
  const lib = await original<typeof import("../../lib/library/summary.ts")>();
  return {
    ...lib,
    syncSummaries: vi.fn(),
    findVideo: vi.fn(async () => undefined),
    summaryItems: vi.fn(lib.summaryItems),
  };
});
vi.mock("../../lib/jobs/jobs.ts", () => ({
  startJob: vi.fn(() => true),
  busyHtml: () => "busy",
}));
vi.mock("../../lib/video/info.ts", async (original) => ({
  ...(await original<typeof import("../../lib/video/info.ts")>()),
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

/** The owner presses a button under the card (message 9) in the library group. */
function pressApi() {
  return {
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
    sendMessage: vi.fn(async () => ({})),
    sendDocument: vi.fn(async () => ({})),
    sendAudio: vi.fn(async () => ({})),
  };
}

/** The texts the owner was answered with. */
const answered = (api: ReturnType<typeof pressApi>) =>
  (
    api.answerCallbackQuery.mock.calls as unknown as [
      string,
      { text?: string }?,
    ][]
  ).map(([, options]) => options?.text);

/** Presses `data`; returns the texts of each keyboard put in place of the card's buttons. */
async function press(data: string, api = pressApi()) {
  await pressButton(summary.composer!, api, data, { text: "📝 Lecture" });
  const calls = api.editMessageReplyMarkup.mock.calls as unknown as [
    number,
    number,
    { reply_markup: { inline_keyboard: { text: string }[][] } },
  ][];
  return calls.map(([, , options]) =>
    options.reply_markup.inline_keyboard.map((row) => row.map((b) => b.text)),
  );
}

/** An English video's folder holding `files` and showing `shown`; the chat gets what the topic would show. */
async function english(files: string[], shown?: object) {
  const root = await mkdtemp(join(tmpdir(), "summary-"));
  const dir = join(root, "Lecture");
  await mkdir(dir);
  const info = {
    id: "lecture0000",
    title: "L",
    categories: [],
    chapters: [],
    language: "en",
  };
  await writeFile(join(dir, "meta.json"), JSON.stringify(info));
  await writeFile(join(dir, "about.md"), "Про що.\n");
  for (const file of files) await writeFile(join(dir, file), "x");
  if (shown) await writeFile(join(dir, "shown.json"), JSON.stringify(shown));
  vi.mocked(findVideo).mockResolvedValue({ dir, info });
  vi.mocked(syncSummaries).mockResolvedValue(undefined);
  const lib = await vi.importActual<
    typeof import("../../lib/library/summary.ts")
  >("../../lib/library/summary.ts");
  vi.mocked(summaryItems).mockImplementation((_root, link) =>
    lib.summaryItems(root, link),
  );
  return dir;
}
const shownOf = async (dir: string) =>
  JSON.parse(await readFile(join(dir, "shown.json"), "utf8")) as unknown;

describe("the card's menus", () => {
  it("opens the summary menu without the shown version, and goes back", async () => {
    await english(["brief.md"], { level: "brief", language: "uk" });
    expect(await press("summary:text:lecture0000")).toEqual([
      [["Brief (EN)"], ["Detailed (UA)", "Detailed (EN)"], ["← Back"]],
    ]);
    expect(await press("summary:back:lecture0000")).toEqual([
      [["📝 Summary", "🎧 Audio"]],
    ]);
  });

  it("opens the audio menu in the shown language, and none before a summary", async () => {
    await english(["brief.en.md"], { level: "brief", language: "en" });
    expect(await press("summary:audio:lecture0000")).toEqual([
      [["👩 Woman (EN)", "👨 Man (EN)"], ["← Back"]],
    ]);
    await english([]);
    const api = pressApi();
    expect(await press("summary:audio:lecture0000", api)).toEqual([]);
    expect(answered(api)).toContain("Make a summary first");
  });

  it("answers a button of an earlier layout as outdated", async () => {
    const api = pressApi();
    await press("summary:lang:brief:lecture0000:en", api);
    expect(answered(api)).toContain("This button is outdated");
  });
});

describe("picking", () => {
  it("shows a written version at once, with its audio of the same kind of voice", async () => {
    const dir = await english(
      ["brief.md", "brief.en.md", "brief - Andrii.mp3", "brief - George.mp3"],
      { level: "brief", language: "uk", voice: "Andrii" },
    );
    const api = pressApi();
    // The menu closes before the files come.
    expect(await press("summary:pick:lecture0000:brief:en", api)).toEqual([
      [["📝 Summary", "🎧 Audio"]],
    ]);
    expect(await shownOf(dir)).toEqual({
      level: "brief",
      language: "en",
      voice: "George",
    });
    await vi.waitFor(() => {
      expect(api.sendDocument).toHaveBeenCalledTimes(1);
      expect(api.sendAudio).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a voice voiced before at once", async () => {
    const dir = await english(
      ["brief.md", "brief - Oksana.mp3", "brief - Andrii.mp3"],
      {
        level: "brief",
        language: "uk",
        voice: "Oksana",
      },
    );
    const api = pressApi();
    await press("summary:voice:lecture0000:Andrii", api);
    expect(await shownOf(dir)).toEqual({
      level: "brief",
      language: "uk",
      voice: "Andrii",
    });
    await vi.waitFor(() => expect(api.sendAudio).toHaveBeenCalledTimes(1));
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  it("starts a job for a version not written yet, and none while the video is made", async () => {
    await english(["brief.md"], { level: "brief", language: "uk" });
    await press("summary:pick:lecture0000:detailed:uk");
    expect(startJob).toHaveBeenCalledTimes(1);
    setMaking("lecture0000/summary", true);
    const api = pressApi();
    await press("summary:pick:lecture0000:detailed:en", api);
    expect(answered(api)).toContain("Already working on it");
    expect(startJob).toHaveBeenCalledTimes(1);
    setMaking("lecture0000/summary", false);
  });
});
