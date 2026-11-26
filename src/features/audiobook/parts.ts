import { bold, escape } from "../../format.ts";
import type { Chapter } from "./library.ts";
import { groupParts } from "./tracks.ts";

/** HolosTTS reads about this many characters a minute. */
const CHARS_PER_MINUTE = 770;

/** About an hour of audio: consecutive tracks, numbered from 1. */
export type Part = { number: number; tracks: Chapter[] };

/** The parts of a book's tracks (see groupParts). Known before voicing: they depend only on the text. */
export function partsOf(tracks: Chapter[]): Part[] {
  return groupParts(tracks).map((group, i) => ({
    number: i + 1,
    tracks: group,
  }));
}

function duration(chars: number): string {
  const minutes = Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

/** «🎧 Part 3 · tracks 7–9 · ≈1 h 2 min», then its chapter titles as a list (Telegram HTML). */
export function partMessage(part: Part): string {
  const first = part.tracks[0]!.index + 1;
  const last = part.tracks.at(-1)!.index + 1;
  const tracks = first === last ? `track ${first}` : `tracks ${first}–${last}`;
  const chars = part.tracks.reduce((sum, t) => sum + t.text.length, 0);
  const head = `🎧 ${bold(`Part ${part.number}`)} · ${tracks} · ≈${duration(chars)}`;
  return `${head}\n\n${part.tracks.map((t) => `• ${escape(t.title)}`).join("\n")}`;
}

/**
 * The title Telegram shows for a track's audio `file`: «001. Chapter title», the title as written in the book; a
 * later file of a long chapter («001 X (2).mp3») adds « (2)».
 */
export function audioTitle(track: Chapter, file: string): string {
  const number = String(track.index + 1).padStart(3, "0");
  const part = / \(([2-9]|\d\d+)\)\.mp3$/.exec(file)?.[1];
  return `${number}. ${track.title}${part ? ` (${part})` : ""}`;
}
