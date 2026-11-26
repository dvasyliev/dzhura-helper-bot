import { Composer, type Context } from "grammy";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { SEND_AGAIN } from "../audiobook/index.ts";
import { folders, loadBook } from "../audiobook/library.ts";
import {
  BOOKS_DIR,
  bookLanguage,
  bookName,
  safeFilename,
} from "../audiobook/text.ts";
import { bold, code, HTML, problem } from "../../format.ts";
import type { Input } from "../../input.ts";
import { readInfo } from "../book/info.ts";
import { BOOK_MD } from "../book/markdown.ts";
import { BOOK_EPUB, buildEpub } from "../book/pandoc.ts";
import { sendEpub } from "../library/send.ts";
import { findFolder, folderKey } from "../translate/button.ts";
import type { Actions, Feature } from "../types.ts";

const BUTTON = "📘 Make EPUB";

/** True for a PDF book (read into book.md) whose EPUB is not made yet. */
export async function canMakeEpub(
  folder: string,
  root = BOOKS_DIR,
): Promise<boolean> {
  const files = await readdir(path.join(root, folder)).catch(
    (): string[] => [],
  );
  return (
    files.includes(BOOK_MD) &&
    !files.includes(BOOK_EPUB) &&
    files.some((f) => f.toLowerCase().endsWith(".pdf"))
  );
}

export async function epubActions(
  input: Input,
  root = BOOKS_DIR,
): Promise<Actions | undefined> {
  if (input.kind !== "book" || !(await canMakeEpub(input.folder, root))) return;
  return {
    buttons: [{ text: BUTTON, data: `epub:${folderKey(input.folder)}` }],
  };
}

const composer = new Composer<Context>();

// The button carries `folderKey` of the book folder, so an old button never picks another book.
composer.callbackQuery(/^epub:([0-9a-f]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const folder = findFolder(ctx.match[1]!, await folders());
  const book = folder && (await loadBook(folder).catch(() => undefined));
  const dir = folder && path.join(BOOKS_DIR, folder);
  const files = dir ? await readdir(dir).catch((): string[] => []) : [];
  if (!folder || !dir || !book || !files.includes(BOOK_MD))
    return ctx.reply(SEND_AGAIN, HTML);
  const file = path.join(dir, BOOK_EPUB);
  try {
    const made = await buildEpub(path.join(dir, BOOK_MD), file, {
      lang: bookLanguage(book.chapters.map((c) => c.text).join("\n")),
      cover: (await readInfo(folder))?.cover,
    });
    if (!made)
      return ctx.reply(
        `⚠️ ${bold("The EPUB needs pandoc")} (${code("brew install pandoc")})`,
        HTML,
      );
  } catch (error) {
    return ctx.reply(
      `⚠️ ${bold("Couldn't make the EPUB")}\n${problem(error)}`,
      HTML,
    );
  }
  await sendEpub(
    ctx.api,
    ctx.chat!.id,
    folder,
    file,
    safeFilename(bookName(book)),
    "epub",
  );
});

export const epub: Feature = {
  id: "epub",
  title: "📘 PDF → EPUB",
  hint: `📘 ${bold("PDF → EPUB")}\nSend a PDF book, then press «${BUTTON}».`,
  composer,
  actions: (input) => epubActions(input),
};
