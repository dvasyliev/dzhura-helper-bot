import { InlineKeyboard } from "grammy";
import { createHash } from "node:crypto";

/** A short key for a book folder that stays the same across restarts; callback data is limited to 64 bytes. */
export function folderKey(folder: string): string {
  return createHash("sha1").update(folder).digest("hex").slice(0, 10);
}

export function findFolder(key: string, folders: string[]): string | undefined {
  return folders.find((folder) => folderKey(folder) === key);
}

/** The «Translate to Ukrainian» button for the book in audiobook folder `folder`. */
export function translateButton(folder: string) {
  return InlineKeyboard.text(
    "🌐 Translate to Ukrainian",
    `translate:${folderKey(folder)}`,
  );
}
