import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coverThumbnail } from "./thumbnail.ts";

const sips = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    done: (error: Error | null) => void,
  ) => {
    sips(command, args);
    done(null);
  },
}));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "thumb-"));
  sips.mockClear();
});

describe("coverThumbnail", () => {
  it("makes a JPEG of at most 320 px next to the cover once, and again for a newer cover", async () => {
    const cover = join(dir, "cover.png");
    const thumb = join(dir, "thumb.jpg");
    await writeFile(cover, "png");
    expect(await coverThumbnail(cover)).toBe(thumb);
    expect(sips).toHaveBeenCalledWith("sips", [
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "80",
      "-Z",
      "320",
      cover,
      "--out",
      thumb,
    ]);

    await writeFile(thumb, "jpg");
    expect(await coverThumbnail(cover)).toBe(thumb);
    expect(sips).toHaveBeenCalledTimes(1);

    await utimes(cover, new Date(), new Date(Date.now() + 60_000));
    await coverThumbnail(cover);
    expect(sips).toHaveBeenCalledTimes(2);
  });

  it("is undefined without a cover", async () => {
    expect(await coverThumbnail(join(dir, "cover.jpg"))).toBeUndefined();
    expect(sips).not.toHaveBeenCalled();
  });
});
