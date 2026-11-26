import { readdir } from "node:fs/promises";
import path from "node:path";
import { chapters, loadBook, shelf } from "../audiobook/library.ts";
import { describeAllParts, partsOf, pendingParts } from "../audiobook/parts.ts";
import { BOOKS_DIR } from "../audiobook/text.ts";
import { isVoiced } from "../audiobook/voice.ts";
import { leftByPace, leftText } from "../../eta.ts";
import { bold } from "../../format.ts";
import type { runClaude } from "../translate/claude.ts";

/** «📝 Describing parts / 3 of 20 · ≈5 min left». */
export function describeText(done: number, total: number, left?: number) {
  const eta = left === undefined || done >= total ? "" : ` · ${leftText(left)}`;
  return `📝 ${bold("Describing parts")}\n${done} of ${total}${eta}`;
}

/**
 * Makes the missing descriptions of every part with voiced audio, of every book on the shelf, so the topics can show
 * them. `show` gets the progress text; it is never called when nothing is missing. A failure leaves a part without a
 * description and never throws.
 */
export async function describeShelf(
  show: (text: string) => Promise<void>,
  run?: typeof runClaude,
): Promise<void> {
  const books = [];
  for (const folder of await shelf()) {
    const dir = path.join(BOOKS_DIR, folder);
    const book = await loadBook(folder).catch(() => undefined);
    if (!book) continue;
    const voices = await readdir(path.join(dir, "audio")).catch(() => []);
    const voiced = partsOf(chapters(book)).filter((part) =>
      part.tracks.some((c) =>
        voices.some((v) => isVoiced(path.join(dir, "audio", v), c.name)),
      ),
    );
    const todo = await pendingParts(dir, voiced);
    if (todo.length) books.push({ dir, todo });
  }
  const total = books.reduce((sum, b) => sum + b.todo.length, 0);
  if (!total) return;
  const started = Date.now();
  let done = 0;
  await show(describeText(0, total));
  for (const { dir, todo } of books)
    await describeAllParts(dir, todo, {
      run,
      onDone: () => {
        done += 1;
        void show(
          describeText(
            done,
            total,
            leftByPace(Date.now() - started, done, total - done),
          ),
        ).catch(() => {});
      },
    });
}
