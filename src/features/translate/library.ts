import path from "node:path";
import { readdirOrEmpty, readdirOrUndefined } from "../../lib/fs/absent.ts";
import { folders } from "../../lib/shelf/shelf.ts";
import { BOOKS_DIR, translationFolder } from "../../lib/shelf/names.ts";
import { BOOK_MD } from "../../lib/book/markdown.ts";

/** Book folders whose `translation/` is started but has no finished book.md yet. */
export async function unfinishedTranslations(
  root = BOOKS_DIR,
): Promise<string[]> {
  const result = [];
  for (const folder of await folders(root)) {
    const files = await readdirOrUndefined(
      path.join(root, translationFolder(folder)),
    );
    if (files && !files.includes(BOOK_MD)) result.push(folder);
  }
  return result;
}

/** How many chunks of the translation in `dir` are already translated. */
export async function doneCount(dir: string): Promise<number> {
  const files = await readdirOrEmpty(path.join(dir, "chunks"));
  return files.filter((f) => f.endsWith(".uk.md")).length;
}
