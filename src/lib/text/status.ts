import { bold, escape, problem } from "./format.ts";

/** The three statuses of a job, worded and marked the same everywhere. */
const STATUS = {
  processing: "⏳ Processing",
  done: "✅ Done",
  failed: "⚠️ Failed",
} as const;

export type Status = keyof typeof STATUS;

/** A language in brackets, as «UA», «EN»; «uk» is written «UA». */
function languageTag(language: string): string {
  const code = language.split("-")[0]!.toLowerCase();
  return (code === "uk" ? "UA" : code).toUpperCase();
}

/** What is made, with its language in brackets: «Detailed Summary (UA)». */
export function withLanguage(what: string, language?: string): string {
  return language ? `${what} (${languageTag(language)})` : what;
}

/**
 * «⏳ Processing: Detailed Summary (UA) - Title» as Telegram HTML. The title is left out in the library group, where the
 * topic already names it; in the bot's chat it goes with `link` when there is one.
 */
export function statusText(
  status: Status,
  what: string,
  title?: string,
  link?: string,
): string {
  const head = bold(`${STATUS[status]}: ${escape(what)}`);
  if (!title) return head;
  const name = link
    ? `<a href="${escape(link)}">${escape(title)}</a>`
    : escape(title);
  return `${head} - ${name}`;
}

/** «⚠️ Failed: Karaoke Music (EN) - Title», then the error's text under it. */
export function failureText(
  what: string,
  error: unknown,
  title?: string,
): string {
  return `${statusText("failed", what, title)}\n${problem(error)}`;
}

/** «3/40 chapters»: how far a job is, always with a slash. */
export function counter(done: number, total: number, unit: string): string {
  return `${done}/${total} ${unit}`;
}
