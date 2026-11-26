import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api } from "grammy";
import { describe, expect, it, vi } from "vitest";
import {
  karaokeItems,
  makeButton,
  songs,
  syncKaraoke,
  type Song,
} from "./karaoke.ts";
import { saveState } from "./state.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

const meta = { duration: 10, width: 640, height: 360 };

function song(folder: string, files: Song["files"]): Song {
  return { folder, name: folder, id: `id-${folder}`, meta, files };
}

const file = (name: string, mtime = 1) => ({ file: name, size: 5, mtime });

describe("karaokeItems", () => {
  it("a song with only the karaoke file gets a placeholder for vocals", () => {
    const items = karaokeItems(
      [song("Song", { music: file("Song (Karaoke).mp4") })],
      [],
      {},
    );
    expect(items[0]).toMatchObject({
      key: "Song/music",
      kind: "video",
      caption: "🎤 <b>Song (Karaoke)</b>",
      video: meta,
    });
    expect(items[1]).toEqual({
      key: "Song/vocals",
      kind: "text",
      text: "⏳ <b>Song (Vocals)</b> — not made yet",
      buttons: [{ text: "🎤 Make it", data: "karaoke:make:id-Song:vocals" }],
    });
  });

  it("an uploaded version is its YouTube link", () => {
    const items = karaokeItems(
      [song("Song", { music: file("Song (Karaoke).mp4") })],
      [],
      { "Song (Karaoke)": "abc" },
    );
    expect(items[0]).toEqual({
      key: "Song/music",
      kind: "text",
      text: "🎤 <b>Song (Karaoke)</b>\nhttps://youtu.be/abc",
    });
  });

  it("posted songs keep their order, new songs go last", () => {
    const a = song("A", { music: file("A (Karaoke).mp4", 5) });
    const b = song("B", { music: file("B (Karaoke).mp4", 3) });
    const c = song("C", { music: file("C (Karaoke).mp4", 1) });
    const keys = karaokeItems([a, b, c], ["B/music", "B/vocals"], {}).map(
      (i) => i.key,
    );
    expect(keys).toEqual([
      "B/music",
      "B/vocals",
      "C/music",
      "C/vocals",
      "A/music",
      "A/vocals",
    ]);
  });
});

describe("makeButton", () => {
  it("data fits 64 bytes", () => {
    const button = makeButton("dQw4w9WgXcQ", "vocals");
    expect(button.data).toBe("karaoke:make:dQw4w9WgXcQ:vocals");
    expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
  });
});

describe("songs", () => {
  it("songs ignores HQ copies, clip.mp4 and folders without current versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karaoke-"));
    const put = async (path: string, text = "x") => {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(join(dir, path), text);
    };
    const m = JSON.stringify({
      id: "i1",
      title: "t",
      artist: "a",
      track: "k",
      ...meta,
    });
    await put("X/meta.json", m);
    await put("X/X (Karaoke).mp4");
    await put("X/X (Karaoke) (HQ).mp4");
    await put("X/X (без голосу).mp4");
    await put("X/clip.mp4");
    await put("Old/meta.json", m);
    await put("Old/Old (без голосу).mp4");
    await put("Old/clip.mp4");
    await put("NoMeta/NoMeta (Karaoke).mp4");
    await utimes(join(dir, "X/X (Karaoke).mp4"), 100, 100);

    const result = await songs(dir);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ folder: "X", id: "i1", meta });
    expect(Object.keys(result[0]!.files)).toEqual(["music"]);
    expect(result[0]!.files.music).toMatchObject({
      file: join(dir, "X/X (Karaoke).mp4"),
      size: 1,
      mtime: 100000,
    });
  });

  it("finds the videos of a song whose folder has its YouTube id added", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karaoke-"));
    await mkdir(join(dir, "S (abc)"));
    await writeFile(
      join(dir, "S (abc)/meta.json"),
      JSON.stringify({ id: "abc", ...meta }),
    );
    await writeFile(join(dir, "S (abc)/S (Vocals).mp4"), "x");

    const [found] = await songs(dir);
    expect(found).toMatchObject({ folder: "S (abc)", name: "S" });
    expect(found!.files.vocals?.file).toBe(join(dir, "S (abc)/S (Vocals).mp4"));
    const items = karaokeItems([found!], [], {});
    expect(items.map((i) => i.key)).toEqual([
      "S (abc)/music",
      "S (abc)/vocals",
    ]);
    expect(items[1]).toMatchObject({ caption: "🎤 <b>S (Vocals)</b>" });
  });

  it("skips a song whose meta.json lacks what the video needs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karaoke-"));
    await mkdir(join(dir, "S"));
    await writeFile(join(dir, "S/meta.json"), JSON.stringify({ id: "abc" }));
    await writeFile(join(dir, "S/S (Vocals).mp4"), "x");
    expect(await songs(dir)).toEqual([]);
  });
});

describe("syncKaraoke", () => {
  it("posts each song's two versions in the karaoke topic", async () => {
    const root = await mkdtemp(join(tmpdir(), "karaoke-sync-"));
    const dirs = {
      karaoke: join(root, "karaoke"),
      youtube: join(root, "youtube.json"),
      state: join(root, "library.json"),
    };
    await mkdir(join(dirs.karaoke, "S"), { recursive: true });
    await writeFile(
      join(dirs.karaoke, "S/meta.json"),
      JSON.stringify({ id: "abcdefghijk", ...meta }),
    );
    await writeFile(join(dirs.karaoke, "S/S (Karaoke).mp4"), "x");
    await writeFile(
      dirs.youtube,
      JSON.stringify({
        refreshToken: "secret",
        videos: { "S (Karaoke)": "yt1" },
      }),
    );
    await saveState({ chatId: -100, topics: {} }, dirs.state);
    let id = 1;
    const api = {
      createForumTopic: vi.fn(() => Promise.resolve({ message_thread_id: 9 })),
      sendMessage: vi.fn(() => Promise.resolve({ message_id: id++ })),
    };

    const synced = await syncKaraoke(api as unknown as Api, dirs);

    expect(api.createForumTopic).toHaveBeenCalledWith(-100, "🎤 Karaoke");
    expect(api.sendMessage.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      "🎤 <b>S (Karaoke)</b>\nhttps://youtu.be/yt1",
      "⏳ <b>S (Vocals)</b> — not made yet",
    ]);
    expect(synced?.changed).toEqual(["S/music", "S/vocals"]);
  });
});
