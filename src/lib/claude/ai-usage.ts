import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Api } from "grammy";
import { z } from "zod";
import { readFileOrUndefined } from "../fs/absent.ts";
import { ownerId } from "../telegram/owner.ts";
import { durationText } from "../text/eta.ts";
import { bold, escape, HTML } from "../text/format.ts";
import { USAGE, type Usage } from "./claude.ts";

/** Every AI operation, and the pinned month total of each month in the owner's chat. */
const AI_USAGE_FILE = "data/ai-usage.json";

const RECORD = z.object({
  /** ISO time it finished. */
  at: z.string(),
  /** What was made, plain text: «📋 Brief summary · <video>». */
  what: z.string(),
  link: z.string().optional(),
  model: z.string().optional(),
  ms: z.number(),
  usage: USAGE,
});
export type AiRecord = z.infer<typeof RECORD>;

const STORE = z.object({
  records: z.array(RECORD).default([]),
  /** The pinned total's message id per month («2026-11»). */
  pins: z.record(z.string(), z.number()).default({}),
});
type Store = z.infer<typeof STORE>;

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** «claude-sonnet-4-5-20250929» → «Sonnet 4.5»; any other name as it is. */
export function modelName(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?$/.exec(model);
  if (!m) return model;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

function noUsage(): Usage {
  return {
    calls: 0,
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    costUsd: 0,
  };
}

function addUsage(sum: Usage, one: Usage): void {
  for (const key of Object.keys(sum) as (keyof Usage)[]) sum[key] += one[key];
}

function tokens(usage: Usage): string {
  const read = usage.input + usage.cacheWrite + usage.cacheRead;
  return `${compact.format(read)} in · ${compact.format(usage.output)} out 💵 ≈$${usage.costUsd.toFixed(2)}`;
}

/**
 * What a job spent (Telegram HTML), the end of its Done message: with Claude's `usage` the tokens and price, then the
 * model and the time; without it (voicing, karaoke) the time alone.
 */
export function spentText(r: {
  ms: number;
  usage?: Usage;
  model?: string;
}): string {
  const time = `⏱ ${durationText(r.ms)}`;
  if (!r.usage) return time;
  const model = r.model ? `🤖 ${escape(modelName(r.model))} ` : "";
  return `🪙 ${tokens(r.usage)}\n${model}${time}`;
}

/** One operation's message (Telegram HTML). */
export function recordText(r: AiRecord): string {
  const [icon, ...rest] = r.what.split(" ");
  const lines = [`${icon} ${bold(escape(rest.join(" ")))}`];
  if (r.link) lines.push(`🔗 ${escape(r.link)}`);
  lines.push(spentText(r));
  return lines.join("\n");
}

/** «2026-11» of an ISO time, in the Mac's time zone. */
function monthOf(at: string): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The pinned month total (Telegram HTML). */
export function monthText(records: AiRecord[], month: string): string {
  const own = records.filter((r) => monthOf(r.at) === month);
  const sum = noUsage();
  for (const r of own) addUsage(sum, r.usage);
  const ms = own.reduce((total, r) => total + r.ms, 0);
  const name = new Date(`${month}-01T12:00:00`).toLocaleString("en", {
    month: "long",
    year: "numeric",
  });
  return [
    `📊 ${bold(`AI in ${name}`)}`,
    `${own.length} operations ⏱ ${durationText(ms)}`,
    `🪙 ${tokens(sum)}`,
  ].join("\n");
}

async function load(file: string): Promise<Store> {
  const text = await readFileOrUndefined(file);
  if (text === undefined) return { records: [], pins: {} };
  return STORE.parse(JSON.parse(text));
}

let reporter: Api | undefined;

/** Where AI operations are reported: the bot's API, set once it starts. */
export function reportAiTo(api: Api): void {
  reporter = api;
}

/**
 * Saves an AI operation, tells the owner about it (unless `message` is false: the job's Done message shows
 * `spentText` instead) and updates the month's pinned total. Never throws: a report must not fail the work it
 * reports on.
 */
export async function reportAi(
  record: Omit<AiRecord, "at">,
  {
    api = reporter,
    file = AI_USAGE_FILE,
    now = new Date(),
    message = true,
  } = {},
): Promise<void> {
  try {
    // Without the bot (tests, scripts) nothing is saved or sent.
    if (!api) return;
    const store = await load(file);
    const full: AiRecord = { at: now.toISOString(), ...record };
    store.records.push(full);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(store, null, 1));
    const chat = ownerId();
    if (message)
      await api.sendMessage(chat, recordText(full), {
        ...HTML,
        link_preview_options: { is_disabled: true },
      });
    const month = monthOf(full.at);
    const total = monthText(store.records, month);
    const pinned = store.pins[month];
    if (pinned !== undefined) {
      await api.editMessageText(chat, pinned, total, HTML);
      return;
    }
    const sent = await api.sendMessage(chat, total, HTML);
    await api.pinChatMessage(chat, sent.message_id, {
      disable_notification: true,
    });
    store.pins[month] = sent.message_id;
    await writeFile(file, JSON.stringify(store, null, 1));
  } catch (error) {
    console.error("AI usage report failed:", error);
  }
}

/** Sums the usage of Claude calls and notes the model and the time since it was made. */
export function aiMeter(now = Date.now) {
  const started = now();
  const usage = noUsage();
  let model: string | undefined;
  return {
    add: (one: Usage, used?: string) => {
      addUsage(usage, one);
      model = used ?? model;
    },
    /** The record of what was metered, made `what` with its `link`. */
    record: (what: string, link?: string): Omit<AiRecord, "at"> => ({
      what,
      ...(link ? { link } : {}),
      ...(model ? { model } : {}),
      ms: now() - started,
      usage: { ...usage },
    }),
  };
}
