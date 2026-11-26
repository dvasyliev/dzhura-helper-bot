import { readdir } from "node:fs/promises";
import path from "node:path";
import { folders } from "../audiobook/library.ts";
import { BOOKS_DIR, translationFolder } from "../audiobook/text.ts";
import { BOOK_MD } from "../book/markdown.ts";

/** Book folders whose `translation/` is started but has no finished book.md yet. */
export async function unfinishedTranslations(
  root = BOOKS_DIR,
): Promise<string[]> {
  const result = [];
  for (const folder of await folders(root)) {
    const files = await readdir(
      path.join(root, translationFolder(folder)),
    ).catch(() => undefined);
    if (files && !files.includes(BOOK_MD)) result.push(folder);
  }
  return result;
}

/** How many chunks of the translation in `dir` are already translated. */
export async function doneCount(dir: string): Promise<number> {
  const files = await readdir(path.join(dir, "chunks")).catch(() => []);
  return files.filter((f) => f.endsWith(".uk.md")).length;
}
