import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { escape } from "../../format.ts";
import { runClaude, type Usage } from "../translate/claude.ts";

const FILE = "descriptions.json";
const PROMPT = fileURLToPath(new URL("description-prompt.md", import.meta.url));
/** A shorter chapter (a title page) gets no description. */
const MIN_CHARS = 300;
/** How much of the chapter's beginning Claude reads. */
const SAMPLE_CHARS = 6000;
/** A description is cut to this; Telegram's caption limit is 1024 characters. */
const MAX_CHARS = 600;
/** One Claude call gives up after this long. */
const CALL_MS = 60_000;

type Run = typeof runClaude;
/** Chapter name → description. */
type Descriptions = Record<string, string>;
const SAVED = z.record(z.string(), z.string());

/** The descriptions saved in `dir`, the voiced book's folder; none when the file is missing or damaged. */
export async function readDescriptions(dir: string): Promise<Descriptions> {
  try {
    return SAVED.parse(
      JSON.parse(await readFile(path.join(dir, FILE), "utf8")),
    );
  } catch {
    return {};
  }
}

/**
 * The caption (Telegram HTML) for an audio `file` of a chapter: «001 X.mp3» or its first part «001 X (1).mp3» gets
 * the chapter's description; later parts and chapters without one get none.
 */
export function captionOf(
  descriptions: Descriptions,
  file: string,
): string | undefined {
  const match = /^(.*?)(?: \((\d+)\))?\.mp3$/.exec(path.basename(file));
  const text = match && Number(match[2] ?? 0) <= 1 && descriptions[match[1]!];
  return text ? escape(text) : undefined;
}

async function describe(
  title: string,
  text: string,
  run: Run,
  onUsage?: (usage: Usage) => void,
): Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), CALL_MS);
  });
  const reply = run(
    PROMPT,
    `Title: ${title}\n\n${text.slice(0, SAMPLE_CHARS)}`,
    onUsage,
    { model: "haiku" },
  );
  reply.catch(() => {}); // a late failure is already given up on
  try {
    const result = await Promise.race([reply, late]);
    return result?.trim().slice(0, MAX_CHARS) || undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The chapters that still need a description: long enough and not described yet. */
export async function pending<T extends { name: string; text: string }>(
  dir: string,
  chapters: T[],
): Promise<T[]> {
  const saved = await readDescriptions(dir);
  return chapters.filter((c) => c.text.length >= MIN_CHARS && !saved[c.name]);
}

type Options = {
  run?: Run;
  waitMs?: number;
  /** Gets the usage of each Claude call. */
  onUsage?: (usage: Usage) => void;
  /** Called after each chapter is handled, made or not. */
  onDone?: () => void;
};

/**
 * Starts making the descriptions of `chapters` in `dir`, one after another, in the background; the descriptions
 * saved before are not made again. Returns a function that waits (at most `waitMs`) until the chapter named
 * `name` is done. A failure is logged and leaves the chapter without a description; nothing here throws.
 */
export function describeChapters(
  dir: string,
  title: string,
  chapters: { name: string; text: string }[],
  { run = runClaude, waitMs = 30_000, onUsage, onDone }: Options = {},
): (name: string) => Promise<void> {
  const done = new Map<string, Promise<void>>();
  let chain: Promise<unknown> = Promise.resolve();
  for (const { name, text } of chapters) {
    const job = chain
      .then(async () => {
        if (text.length < MIN_CHARS) return;
        const saved = await readDescriptions(dir);
        if (saved[name]) return;
        try {
          const description = await describe(title, text, run, onUsage);
          if (!description) return;
          // Read again: another voice's run may have saved meanwhile.
          const latest = await readDescriptions(dir);
          await writeFile(
            path.join(dir, FILE),
            JSON.stringify({ ...latest, [name]: description }, null, 2),
          );
        } catch (error) {
          console.error(
            `Description of «${name}» failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      })
      .finally(() => onDone?.());
    done.set(name, job);
    chain = job;
  }
  return async (name) => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    });
    await Promise.race([done.get(name), late]);
    clearTimeout(timer);
  };
}

/** Makes the descriptions of `chapters` and returns when all are handled (each Claude call gives up after CALL_MS). */
export async function describeAll(
  dir: string,
  title: string,
  chapters: { name: string; text: string }[],
  options: Omit<Options, "waitMs"> = {},
): Promise<void> {
  const last = chapters.at(-1);
  if (last)
    await describeChapters(dir, title, chapters, {
      ...options,
      waitMs: 2 ** 31 - 1,
    })(last.name);
}
