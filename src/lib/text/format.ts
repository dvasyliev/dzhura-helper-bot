/** Telegram HTML for the bot's messages: every dynamic value goes through `escape` first. */

/** Send options that make Telegram read the text as HTML. */
export const HTML = { parse_mode: "HTML" } as const;

/** Telegram's message limit is 4096 characters; the rest of a long error is cut. */
const MAX_ERROR_CHARS = 1000;

/** Telegram HTML needs only `&`, `<` and `>` escaped. */
export function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Already escaped HTML in bold. */
export function bold(html: string): string {
  return `<b>${html}</b>`;
}

/** Already escaped HTML in monospace. */
export function code(html: string): string {
  return `<code>${html}</code>`;
}

/** The block for numbers and stats, one fact per line; already escaped HTML. */
export function quote(lines: string[]): string {
  return `<blockquote>${lines.join("\n")}</blockquote>`;
}

/** An error's text as safe, short HTML. */
export function problem(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return escape(
    text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text,
  );
}
