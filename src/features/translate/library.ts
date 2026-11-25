import { readdir } from "node:fs/promises";
import path from "node:path";
import { TRANSLATE_DIR } from "./pipeline.ts";

/** Translation folders without the assembled `book.uk.md`, by name. */
export async function unfinishedTranslations(
  root = TRANSLATE_DIR,
): Promise<string[]> {
  const folders = (
    await readdir(root, { withFileTypes: true }).catch(() => [])
  ).filter((f) => f.isDirectory());
  const result = [];
  for (const { name } of folders) {
    const files = await readdir(path.join(root, name));
    if (!files.includes("book.uk.md")) result.push(name);
  }
  return result.sort();
}

/** How many chunks of the translation in `dir` are already translated. */
export async function doneCount(dir: string): Promise<number> {
  const files = await readdir(path.join(dir, "chunks")).catch(() => []);
  return files.filter((f) => f.endsWith(".uk.md")).length;
}
