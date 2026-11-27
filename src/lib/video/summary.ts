import { bold, escape } from "../text/format.ts";

/** The heading of each file's level, in the language of its text. */
export const LEVEL_NAMES = {
  uk: { brief: "Стисло", detailed: "Детально" },
  en: { brief: "Brief", detailed: "Detailed" },
} as const;

/** Telegram's limit for a message's text. */
const MAX_MESSAGE = 4096;

export function videoUrl(id: string): string {
  return `https://youtu.be/${id}`;
}

/** The message: title, link and as many of the description's paragraphs as fit. */
export function aboutMessage(title: string, id: string, about: string): string {
  let text = `📝 ${bold(escape(title))}\n${videoUrl(id)}`;
  for (const paragraph of about.split(/\n\s*\n/)) {
    const part = `\n\n${escape(paragraph.trim())}`;
    if (!paragraph.trim()) continue;
    if (text.length + part.length > MAX_MESSAGE) break;
    text += part;
  }
  return text;
}
