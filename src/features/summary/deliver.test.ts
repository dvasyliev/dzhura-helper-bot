import type { Api } from "grammy";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { syncSummaries } from "../../lib/library/summary.ts";
import { deliver } from "./deliver.ts";

vi.mock("../../lib/library/summary.ts", async (original) => ({
  ...(await original<typeof import("../../lib/library/summary.ts")>()),
  syncSummaries: vi.fn(),
}));

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

  it("with a group sends «Done → link» to the slot's message", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce({
      changed: [],
      link: (key) =>
        key === "lecture0000/audio" ? "https://t.me/c/1/2/4" : undefined,
    });
    const api = fakeApi();
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "audio",
      await described(),
    );
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "✅ <b>Done</b> → https://t.me/c/1/2/4",
      { parse_mode: "HTML" },
    );
    expect(api.sendAudio).not.toHaveBeenCalled();
  });

  it("without a group sends the card here with its buttons, and no placeholders", async () => {
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
    ]);
    expect(
      calls[0]![2].reply_markup?.inline_keyboard[0]!.map(
        (b) => b.callback_data,
      ),
    ).toEqual(["summary:text:lecture0000", "summary:audio:lecture0000"]);
  });

  it("without a group sends the shown summary and its audio under the video's name", async () => {
    const root = await described();
    await writeFile(join(root, "Lecture", "brief - Oksana.mp3"), "abc");
    await writeFile(
      join(root, "Lecture", "shown.json"),
      JSON.stringify({ level: "brief", language: "uk", voice: "Oksana" }),
    );
    vi.mocked(syncSummaries).mockResolvedValue(undefined);
    const api = fakeApi();
    await deliver(api as unknown as Api, 5, "lecture0000", "summary", root);
    await deliver(api as unknown as Api, 5, "lecture0000", "audio", root);
    expect(api.sendDocument).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ filename: "Brief: Lecture.md" }),
      expect.anything(),
    );
    expect(api.sendAudio).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ filename: "Brief: Lecture.mp3" }),
      expect.objectContaining({ title: "Brief: Lecture" }),
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("without a group sends nothing for a slot not made yet", async () => {
    vi.mocked(syncSummaries).mockResolvedValueOnce(undefined);
    const api = fakeApi();
    await deliver(
      api as unknown as Api,
      5,
      "lecture0000",
      "audio",
      await described(),
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.sendAudio).not.toHaveBeenCalled();
  });
});
