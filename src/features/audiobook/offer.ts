import { InlineKeyboard, type Context } from "grammy";
import { bold, escape, HTML, quote } from "../../lib/text/format.ts";
import { bookName, bookPaths } from "../../lib/shelf/names.ts";
import type { ShelfBook } from "../../lib/shelf/shelf.ts";
import type { Language } from "../../lib/book/language.ts";
import {
  isVoiced,
  voiceLabel,
  voicesFor,
  type Voice,
} from "../../lib/tts/voice.ts";
import { chapters, type Chapter } from "../../lib/book/tracks.ts";
import { voicedCount } from "./library.ts";
import { forecast } from "./text.ts";

export const SEND_AGAIN = `⚠️ ${bold("This book is no longer here")}\nSend it again.`;

/** The book waiting for a voice and the one waiting for an amount of chapters; the composer reads and sets them. */
export const picking: {
  /** The last book sent, waiting for the voice to be chosen. */
  pending?: ShelfBook;
  /** Book and voice waiting for how many chapters to voice: a button or typed numbers («10-20»). */
  choosing?: { book: ShelfBook; voice: Voice };
} = {};

export async function remaining(
  book: ShelfBook,
  voice: Voice,
): Promise<Chapter[]> {
  const { audioDir } = bookPaths(book.folder, voice.name);
  const all = chapters(book);
  const voiced = await Promise.all(all.map((c) => isVoiced(audioDir, c.name)));
  return all.filter((_, i) => !voiced[i]);
}

/** What is already voiced, the forecast and the buttons with the voices of the book's language; an English book can also be translated. */
export async function offer(ctx: Context, book: ShelfBook, language: Language) {
  picking.pending = book;
  picking.choosing = undefined;
  const all = chapters(book);
  const voices = voicesFor(language);
  const resume = (
    await Promise.all(
      voices.map(async (v) => {
        const left = (await remaining(book, v)).length;
        return left && left < all.length;
      }),
    )
  ).some(Boolean);
  const text = [
    `❓ ${bold("Which voice?")}\n${escape(bookName(book))}`,
    quote([
      `${all.length} chapters`,
      ...(await voicedSoFar(book, all, voices)),
      ...estimate(all, voices[0]),
    ]),
    ...(resume ? ["Pick the same voice to continue where it stopped."] : []),
  ].join("\n\n");
  const keyboard = new InlineKeyboard();
  for (const voice of voices)
    keyboard.text(voiceLabel(voice.name), `voice:${voice.id}`);
  await ctx.reply(text, { ...HTML, reply_markup: keyboard });
}

/** «Already voiced by «👩 Woman (UA)»: 12 of 71» (HTML) for each voice that has audio of this book. */
export async function voicedSoFar(
  book: ShelfBook,
  all: Chapter[],
  voices: Voice[],
): Promise<string[]> {
  const done = (
    await Promise.all(
      voices.map(async (voice) => ({
        voice,
        count: await voicedCount(book, voice, all),
      })),
    )
  ).filter((d) => d.count);
  return done.map(
    (d) =>
      `Already voiced by «${voiceLabel(d.voice.name)}»: ${d.count} of ${all.length}`,
  );
}

/** The forecast's lines, for a quote. */
export function estimate(todo: Chapter[], voice: Voice): string[] {
  return forecast(
    todo.map((c) => c.text.length),
    voice.provider,
  ).split("\n");
}
