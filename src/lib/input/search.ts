import { Composer, InlineKeyboard, type Context } from "grammy";
import { clearButtons } from "../telegram/buttons.ts";
import { bold, escape, HTML, problem } from "../text/format.ts";
import { MAX_FOUND, loadBook, shelf, type ShelfBook } from "../shelf/shelf.ts";
import { findBooks, shelfLabel } from "../shelf/names.ts";
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
    found = findBooks(text, await shelf()).slice(0, MAX_FOUND);
    if (!found.length)
      return ctx.reply(
        `⚠️ ${bold("No such book yet")}\nSend the EPUB or PDF.`,
        HTML,
      );
    if (found.length === 1) {
      const keyboard = new InlineKeyboard()
        .text("Yes", "found:0")
        .text("No", "found:no");
      return ctx.reply(
        `❓ ${bold(`«${escape(shelfLabel(found[0]!))}»: this one?`)}`,
        {
          ...HTML,
          reply_markup: keyboard,
        },
      );
    }
    const list = InlineKeyboard.from(
      found.map((name, i) => [
        InlineKeyboard.text(shelfLabel(name), `found:${i}`),
      ]),
    );
    await ctx.reply(
      `❓ ${bold("Which one?")}\nIf it isn't here, refine the title.`,
      { ...HTML, reply_markup: list },
    );
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
  use: (book: ShelfBook, folder: string) => unknown,
) {
  await ctx.answerCallbackQuery();
  await clearButtons(ctx);
  if (!folder)
    return ctx.reply(
      `📕 ${bold("OK")}\nWrite the title or author differently, or send the EPUB or PDF.`,
      HTML,
    );
  try {
    const book = await loadBook(folder);
    if (!book)
      return ctx.reply(
        `⚠️ ${bold(`The folder «${escape(folder)}» has no EPUB or book.md`)}\nSend the book again.`,
        HTML,
      );
    await use(book, folder);
  } catch (error) {
    await ctx.reply(`⚠️ ${bold("Error")}\n${problem(error)}`, HTML);
  }
}
