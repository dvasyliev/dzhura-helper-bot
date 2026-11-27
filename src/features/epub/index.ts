import { Composer, type Context } from "grammy";
import { readdirOrEmpty } from "../../lib/fs/absent.ts";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { SEND_AGAIN } from "../audiobook/index.ts";
import { folders, tryLoadBook } from "../../lib/shelf/shelf.ts";
import { BOOKS_DIR, bookName, safeFilename } from "../../lib/shelf/names.ts";
import { bookLanguage } from "../../lib/book/language.ts";
import { failureText } from "../../lib/text/status.ts";
import { spentText } from "../../lib/claude/ai-usage.ts";
import { bold, code, HTML } from "../../lib/text/format.ts";
import type { Input } from "../../lib/input/input.ts";
import { readInfo } from "../../lib/book/info.ts";
import { BOOK_MD } from "../../lib/book/markdown.ts";
import { BOOK_EPUB, buildEpub } from "../../lib/book/pandoc.ts";
import { sendEpub } from "../../lib/library/send.ts";
import { findFolder, folderKey } from "../../lib/book/folder-key.ts";
import type { Actions, Feature } from "../../lib/feature/types.ts";

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
  const book = folder && (await tryLoadBook(folder));
  const dir = folder && path.join(BOOKS_DIR, folder);
  const files = dir ? await readdirOrEmpty(dir) : [];
  if (!folder || !dir || !book || !files.includes(BOOK_MD))
    return ctx.reply(SEND_AGAIN, HTML);
  const file = path.join(dir, BOOK_EPUB);
  const started = Date.now();
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
    return ctx.reply(failureText("Book EPUB", error, book.title), HTML);
  }
  await sendEpub(
    ctx.api,
    ctx.chat!.id,
    folder,
    file,
    safeFilename(bookName(book)),
    "epub",
    {
      what: "Book EPUB",
      title: book.title,
      spent: spentText({ ms: Date.now() - started }),
    },
  );
});

export const epub: Feature = {
  id: "epub",
  title: "📘 PDF → EPUB",
  hint: `📘 ${bold("PDF → EPUB")}\nSend a PDF book, then press «${BUTTON}».`,
  composer,
  actions: (input) => epubActions(input),
};
