import { execFile } from "node:child_process";
import { statOrUndefined } from "../fs/absent.ts";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
/** Telegram's most for a thumbnail's sides; such a JPEG stays far under its 200 kB. */
const SIDE = 320;
const NAME = "thumb.jpg";

/**
 * A small JPEG of `cover` next to it, the album art of the book's audio: made with macOS `sips` once, and again when
 * the cover is newer. Undefined without a cover or when it cannot be made.
 */
export async function coverThumbnail(
  cover: string,
): Promise<string | undefined> {
  const thumb = path.join(path.dirname(cover), NAME);
  const [source, made] = await Promise.all(
    [cover, thumb].map((file) => statOrUndefined(file)),
  );
  if (!source) return undefined;
  if (made && made.mtimeMs >= source.mtimeMs) return thumb;
  try {
    await run(
      "sips",
      [
        ...["-s", "format", "jpeg", "-s", "formatOptions", "80"],
        ...["-Z", String(SIDE), cover, "--out", thumb],
      ],
      { timeout: 60_000 },
    );
    return thumb;
  } catch (error) {
    console.error(
      "Cover thumbnail failed:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}
