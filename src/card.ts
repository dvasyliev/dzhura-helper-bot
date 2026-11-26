import { InlineKeyboard, type Context } from "grammy";
import type { Actions, Feature } from "./features/types.ts";
import { linkInput, type Input } from "./input.ts";

const LANGUAGE_NAMES = { uk: "Ukrainian", en: "English", ru: "Russian" };

export type Card =
  | { kind: "none" }
  | { kind: "ask"; ask: (ctx: Context) => Promise<unknown> }
  | { kind: "card"; text: string; keyboard: InlineKeyboard };

/**
 * What to reply to `input` given every feature's actions: nothing fits, the one feature's question at once,
 * or a card with the input's summary and one button per action.
 */
export function card(input: Input, all: Actions[]): Card {
  const offered = all.filter((a) => a.buttons.length);
  if (!offered.length) return { kind: "none" };
  const [only] = offered;
  if (offered.length === 1 && only?.ask) return { kind: "ask", ask: only.ask };
  const keyboard = InlineKeyboard.from(
    offered.flatMap((a) =>
      a.buttons.map((b) => [InlineKeyboard.text(b.text, b.data)]),
    ),
  );
  const text = [
    ...header(input),
    ...offered.flatMap((a) => a.lines ?? []),
  ].join("\n");
  return { kind: "card", text, keyboard };
}

function header(input: Input): string[] {
  if (input.kind === "youtube") return ["🎬 YouTube video"];
  if (input.kind === "link") return [input.url];
  const { book, language } = input;
  const size = `${book.chapters.length} chapters`;
  return [
    `📕 ${book.title}`,
    ...(book.author ? [book.author] : []),
    language ? `${LANGUAGE_NAMES[language]} · ${size}` : size,
  ];
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
  return card(input, all);
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
