import { bold, escape } from "../text/format.ts";

/** One topic in the /publish status. */
export type Row = {
  name: string;
  state: "waiting" | "running" | "done";
  /** Messages sent or edited so far, of all to send or edit. */
  sent?: readonly [number, number];
  /** Messages changed, once done. */
  changed?: number;
  /** The topic's link, once done. */
  link?: string;
};

const ICON = { waiting: "⏳", running: "🔄", done: "✅" };

function row({ name, state, sent, changed, link }: Row): string {
  const title = link
    ? `<a href="${escape(link)}">${escape(name)}</a>`
    : escape(name);
  const detail =
    state === "running" && sent
      ? `${sent[0]} of ${sent[1]} | `
      : state === "done"
        ? changed
          ? `${changed} updated | `
          : "no changes | "
        : "";
  return `${ICON[state]} ${detail}${title}`;
}

/** The /publish status (Telegram HTML): a header, then a line per topic. */
export function publishStatus(rows: Row[], end?: "done" | "stopped"): string {
  const done = rows.filter((r) => r.state === "done").length;
  const head =
    end === "done"
      ? `✅ ${bold("Library is up to date")} · ${rows.length} topics`
      : end === "stopped"
        ? `⚠️ ${bold("Publishing stopped")} · the library group is unavailable`
        : `📚 ${bold("Publishing the library")} · ${done} of ${rows.length} topics`;
  return [head, "", ...rows.map(row)].join("\n");
}

/**
 * One status message kept up to date: the first text is sent, later ones edit it at most every `intervalMs` (Telegram
 * limits edits), and a `final` one always. A failed edit is skipped: the next one catches up.
 */
export function liveStatus(
  send: (text: string) => Promise<number | undefined>,
  edit: (messageId: number, text: string) => Promise<unknown>,
  { intervalMs = 3000, now = Date.now } = {},
): (text: string, final?: boolean) => Promise<void> {
  let messageId: number | undefined;
  let last = 0;
  return async (text, final = false) => {
    if (messageId === undefined) {
      messageId = await send(text);
      last = now();
      return;
    }
    if (!final && now() - last < intervalMs) return;
    last = now();
    await edit(messageId, text).catch((error: unknown) =>
      console.error("Publish status edit failed:", error),
    );
  };
}
