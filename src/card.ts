import { InlineKeyboard, type Context } from "grammy";
import type { Actions, Feature } from "./features/types.ts";
import { bookCaption } from "./features/book/caption.ts";
import { bookInfo, type BookInfo } from "./features/book/info.ts";
import { bold, escape, quote } from "./format.ts";
import { linkInput, type Input } from "./input.ts";

export type Card =
  | { kind: "none" }
  | { kind: "ask"; ask: (ctx: Context) => Promise<unknown> }
  | { kind: "card"; text: string; keyboard: InlineKeyboard; photo?: string };

/**
 * What to reply to `input` given every feature's actions: nothing fits, the one feature's question at once,
 * or a card with the input's summary and one button per action.
 */
export function card(input: Input, all: Actions[], info?: BookInfo): Card {
  const offered = all.filter((a) => a.buttons.length);
  if (!offered.length) return { kind: "none" };
  const [only] = offered;
  if (offered.length === 1 && only?.ask) return { kind: "ask", ask: only.ask };
  const keyboard = InlineKeyboard.from(
    offered.flatMap((a) =>
      a.buttons.map((b) => [InlineKeyboard.text(b.text, b.data)]),
    ),
  );
  const lines = offered.flatMap((a) => a.lines ?? []);
  if (input.kind === "book") {
    const text = bookCaption({
      book: input.book,
      chapters: input.book.chapters.length,
      language: input.language,
      info,
      lines,
    });
    return { kind: "card", text, keyboard, photo: info?.cover };
  }
  const head =
    input.kind === "youtube"
      ? `🎬 ${bold("YouTube video")}`
      : `🔗 ${escape(input.url)}`;
  const text = [head, ...(lines.length ? [quote(lines)] : [])].join("\n\n");
  return { kind: "card", text, keyboard };
}

/** The reply to `input`, from the actions of `features` in their order. */
export async function cardFor(
  input: Input,
  features: Pick<Feature, "actions">[],
): Promise<Card> {
  const all: Actions[] = [];
  for (const feature of features) {
    const actions = await feature.actions?.(input);
    if (actions) all.push(actions);
  }
  const plain = card(input, all);
  if (plain.kind !== "card" || input.kind !== "book") return plain;
  return card(input, all, await bookInfo(input.folder, input.book));
}

/**
 * The reply to a text with a link some feature can use; undefined passes the text on to the features
 * (book search, lyrics pasted after a song, even with a link inside).
 */
export async function routeText(
  text: string,
  features: Pick<Feature, "actions">[],
): Promise<Card | undefined> {
  const input = text.startsWith("/") ? undefined : linkInput(text);
  if (!input) return undefined;
  const reply = await cardFor(input, features);
  return reply.kind === "none" ? undefined : reply;
}
