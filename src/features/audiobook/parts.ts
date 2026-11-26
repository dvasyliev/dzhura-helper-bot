import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { bold, escape } from "../../format.ts";
import { runClaude, type Usage } from "../translate/claude.ts";
import type { Chapter } from "./library.ts";
import { groupParts } from "./tracks.ts";

const FILE = "parts.json";
const PROMPT = fileURLToPath(new URL("part-prompt.md", import.meta.url));
/** A shorter part (a title page) gets no description. */
const MIN_CHARS = 300;
/** How much of the tracks' text Claude reads in all; each track gives an equal share of its beginning. */
const SAMPLE_CHARS = 15_000;
/** A description is cut to this. */
const MAX_CHARS = 700;
/** One Claude call gives up after this long. */
const CALL_MS = 90_000;
/** HolosTTS reads about this many characters a minute. */
const CHARS_PER_MINUTE = 770;

type Run = typeof runClaude;
/** Part key → description. */
type Saved = Record<string, string>;
const SAVED = z.record(z.string(), z.string());

/** About an hour of audio: consecutive tracks, numbered from 1. */
export type Part = { number: number; tracks: Chapter[] };

/** The parts of a book's tracks (see groupParts). Known before voicing: they depend only on the text. */
export function partsOf(tracks: Chapter[]): Part[] {
  return groupParts(tracks).map((group, i) => ({
    number: i + 1,
    tracks: group,
  }));
}

/** What a part's description is saved under: the names of its first and last track. */
export function partKey({ tracks }: Part): string {
  return `${tracks[0]!.name}|${tracks.at(-1)!.name}`;
}

/** The descriptions saved in `dir`, the voiced book's folder; none when the file is missing or damaged. */
export async function readParts(dir: string): Promise<Saved> {
  try {
    return SAVED.parse(
      JSON.parse(await readFile(path.join(dir, FILE), "utf8")),
    );
  } catch {
    return {};
  }
}

function duration(chars: number): string {
  const minutes = Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

/** «🎧 Part 3 · tracks 7–9 · ≈1 h 2 min», then the description (Telegram HTML) when there is one. */
export function partMessage(part: Part, description?: string): string {
  const first = part.tracks[0]!.index + 1;
  const last = part.tracks.at(-1)!.index + 1;
  const tracks = first === last ? `track ${first}` : `tracks ${first}–${last}`;
  const chars = part.tracks.reduce((sum, t) => sum + t.text.length, 0);
  const head = `🎧 ${bold(`Part ${part.number}`)} · ${tracks} · ≈${duration(chars)}`;
  return description ? `${head}\n\n${escape(description)}` : head;
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

function sample(part: Part): string {
  const share = Math.floor(SAMPLE_CHARS / part.tracks.length);
  return part.tracks
    .map((t) => `Track: ${t.title}\n${t.text.slice(0, share)}`)
    .join("\n\n");
}

async function describe(
  part: Part,
  run: Run,
  onUsage?: (usage: Usage) => void,
): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), CALL_MS);
  });
  const reply = run(PROMPT, sample(part), onUsage, { model: "haiku" });
  reply.catch(() => {}); // a late failure is already given up on
  try {
    const result = await Promise.race([reply, late]);
    return result?.trim().slice(0, MAX_CHARS) || undefined;
  } finally {
    clearTimeout(timer);
  }
}

function size(part: Part): number {
  return part.tracks.reduce((sum, t) => sum + t.text.length, 0);
}

/** The parts that still need a description: long enough and not described yet. */
export async function pendingParts(
  dir: string,
  parts: Part[],
): Promise<Part[]> {
  const saved = await readParts(dir);
  return parts.filter((p) => size(p) >= MIN_CHARS && !saved[partKey(p)]);
}

type Options = {
  run?: Run;
  waitMs?: number;
  /** Gets the usage of each Claude call. */
  onUsage?: (usage: Usage) => void;
  /** Called after each part is handled, made or not. */
  onDone?: () => void;
};

/**
 * Starts making the descriptions of `parts` in `dir`, one after another, in the background; the ones saved before
 * are not made again. Returns a function that waits (at most `waitMs`) until a part is done. A failure is logged and
 * leaves the part without a description; nothing here throws.
 */
export function describeParts(
  dir: string,
  parts: Part[],
  { run = runClaude, waitMs = 30_000, onUsage, onDone }: Options = {},
): (part: Part) => Promise<void> {
  const done = new Map<string, Promise<void>>();
  let chain: Promise<unknown> = Promise.resolve();
  for (const part of parts) {
    const key = partKey(part);
    const job = chain
      .then(async () => {
        if (size(part) < MIN_CHARS || (await readParts(dir))[key]) return;
        try {
          const description = await describe(part, run, onUsage);
          if (!description) return;
          // Read again: another voice's run may have saved meanwhile.
          const latest = await readParts(dir);
          await writeFile(
            path.join(dir, FILE),
            JSON.stringify({ ...latest, [key]: description }, null, 2),
          );
        } catch (error) {
          console.error(
            `Description of part ${part.number} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      })
      .finally(() => onDone?.());
    done.set(key, job);
    chain = job;
  }
  return async (part) => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    });
    await Promise.race([done.get(partKey(part)), late]);
    clearTimeout(timer);
  };
}

/** Makes the descriptions of `parts` and returns when all are handled (each Claude call gives up after CALL_MS). */
export async function describeAllParts(
  dir: string,
  parts: Part[],
  options: Omit<Options, "waitMs"> = {},
): Promise<void> {
  const last = parts.at(-1);
  if (last)
    await describeParts(dir, parts, { ...options, waitMs: 2 ** 31 - 1 })(last);
}
