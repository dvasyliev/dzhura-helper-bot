import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";

/** True for «no such file or folder»: the only error these helpers read as «not there». */
export function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function orElse<T, U>(read: Promise<T>, absent: U): Promise<T | U> {
  try {
    return await read;
  } catch (error) {
    if (isAbsent(error)) return absent;
    throw error;
  }
}

/** The names in folder `dir`; empty when it does not exist. Any other error (permissions, disk) is thrown. */
export function readdirOrEmpty(dir: string): Promise<string[]> {
  return orElse(readdir(dir), []);
}

/** The names in folder `dir`; undefined when it does not exist. Any other error is thrown. */
export function readdirOrUndefined(dir: string): Promise<string[] | undefined> {
  return orElse(readdir(dir), undefined);
}

/** The entries in folder `dir`; empty when it does not exist. Any other error is thrown. */
export function readdirEntriesOrEmpty(dir: string): Promise<Dirent[]> {
  return orElse(readdir(dir, { withFileTypes: true }), []);
}

/** The stats of `file`; undefined when it does not exist. Any other error is thrown. */
export function statOrUndefined(file: string): Promise<Stats | undefined> {
  return orElse(stat(file), undefined);
}

/** The UTF-8 text of `file`; undefined when it does not exist. Any other error is thrown. */
export function readFileOrUndefined(file: string): Promise<string | undefined> {
  return orElse(readFile(file, "utf8"), undefined);
}
