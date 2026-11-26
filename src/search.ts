import { Composer, InlineKeyboard, type Context } from "grammy";
import { readdir } from "node:fs/promises";
import { message } from "./features/audiobook/deliver.ts";
import {
  BOOKS_DIR,
  MAX_FOUND,
  loadBook,
} from "./features/audiobook/library.ts";
import { findBooks } from "./features/audiobook/text.ts";
import type { Book } from "./features/book/epub.ts";
import { bookInput, type Input } from "./input.ts";

/** Book folders offered by the last search; buttons refer to them by index. */
let found: string[] = [];

/**
 * A book sent before, found by a word of its author or title, then shown like a sent book: every feature's actions.
 * Links and multi-line texts (song lyrics) are not titles.
 */
export function bookSearch(show: (ctx: Context, input: Input) => unknown) {
  const composer = new Composer<Context>();

  composer.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (
      text.startsWith("/") ||
      text.includes("\n") ||
      /https?:\/\/|youtu\.?be/.test(text)
    )
      return next();
    const folders = await readdir(BOOKS_DIR, { withFileTypes: true }).catch(
      () => [],
    );
    found = findBooks(
      text,
      folders.filter((f) => f.isDirectory()).map((f) => f.name),
    ).slice(0, MAX_FOUND);
    if (!found.length)
      return ctx.reply("No such book yet. Send the EPUB or PDF.");
    if (found.length === 1) {
      const keyboard = new InlineKeyboard()
        .text("Yes", "found:0")
        .text("No", "found:no");
      return ctx.reply(`«${found[0]}»: this one?`, { reply_markup: keyboard });
    }
    const list = InlineKeyboard.from(
      found.map((name, i) => [InlineKeyboard.text(name, `found:${i}`)]),
    );
    await ctx.reply(`Which one? If it isn't here, refine the title.`, {
      reply_markup: list,
    });
  });

  composer.callbackQuery(/^found:(.+)$/, (ctx) =>
    pressedBook(ctx, found[Number(ctx.match[1])], (book, folder) =>
      show(ctx, bookInput(book, folder)),
    ),
  );

  return composer;
}

/** A pressed book button: loads the book of `folder` (none for «No») and hands it to `use`. */
export async function pressedBook(
  ctx: Context,
  folder: string | undefined,
  use: (book: Book, folder: string) => unknown,
) {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  if (!folder)
    return ctx.reply(
      "OK. Write the title or author differently, or send the EPUB or PDF.",
    );
  try {
    const book = await loadBook(folder);
    if (!book)
      return ctx.reply(
        `The folder «${folder}» has no EPUB or book.md. Send the book again.`,
      );
    await use(book, folder);
  } catch (error) {
    await ctx.reply(`Error: ${message(error)}`);
  }
}
