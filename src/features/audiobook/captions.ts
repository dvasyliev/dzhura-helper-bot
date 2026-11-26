import { bold, escape } from "../../format.ts";
import type { Chapter } from "./library.ts";
import { CHARS_PER_MINUTE } from "./tracks.ts";

/** «12 min», «1 h», «1 h 2 min»; at least a minute. */
function duration(chars: number): string {
  const minutes = Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

/** « (2)» for a later file of a long chapter («001 X (2).mp3»), else empty. */
function fileSuffix(file: string): string {
  const number = / \(([2-9]|\d\d+)\)\.mp3$/.exec(file)?.[1];
  return number ? ` (${number})` : "";
}

/**
 * The title Telegram shows for a track's audio `file`: «001. Chapter title», the title as written in the book; a
 * later file of a long chapter («001 X (2).mp3») adds « (2)».
 */
export function audioTitle(track: Chapter, file: string): string {
  const number = String(track.index + 1).padStart(3, "0");
  return `${number}. ${track.title}${fileSuffix(file)}`;
}

/**
 * The caption under a track's audio `file` (Telegram HTML): «Розділ I. Title», then «⏱ 20 min» on its own line. The time is estimated from
 * the text, shared evenly by the chapter's `files`.
 */
export function audioCaption(track: Chapter, file: string, files = 1): string {
  const time = duration(track.text.length / files);
  return `${escape(track.title)}${fileSuffix(file)}\n⏱ ${time}`;
}

/** The message before one of the book's own parts (Telegram HTML): «📖 Частина друга», then «⏱ 6 h 21 min» on its own line, its tracks' time. */
export function bookPartMessage(name: string, tracks: Chapter[]): string {
  const chars = tracks.reduce((sum, t) => sum + t.text.length, 0);
  return `📖 ${bold(escape(name))}\n⏱ ${duration(chars)}`;
}
