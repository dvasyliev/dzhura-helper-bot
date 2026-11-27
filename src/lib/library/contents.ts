import type { Item } from "./reconcile.ts";

/** Telegram's limit for a message's visible text. */
const MAX_MESSAGE = 4096;

/** The length of Telegram HTML as shown: tags dropped, entities as one character. */
function visible(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&\w+;/g, "_").length;
}

/** A topic's pinned first message: `head`, then a line per entry, oldest first. */
export function contentsItem(head: string, lines: string[]): Item {
  // Telegram counts the visible text only: past its limit the oldest lines go, the newest stay.
  let shown = lines;
  while (shown.length && visible([head, ...shown].join("\n")) > MAX_MESSAGE)
    shown = shown.slice(1);
  return {
    key: "contents",
    kind: "text",
    text: [head, ...shown].join("\n"),
    pin: true,
  };
}

/** The video's cover on YouTube, shown above its message. */
export function coverUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}
