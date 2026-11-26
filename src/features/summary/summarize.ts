import { fileURLToPath } from "node:url";
import { bold, escape } from "../../format.ts";
import { runClaude } from "../translate/claude.ts";
import type { VideoInfo } from "../video/info.ts";

/** «about» is the description in the message; «brief» and «detailed» are the .md files made on request. */
export type Level = "about" | "brief" | "detailed";

/** The heading of each file's level. */
export const LEVEL_NAMES = { brief: "Стисло", detailed: "Детально" } as const;

/** Telegram's limit for a message's text. */
const MAX_MESSAGE = 4096;

function videoUrl(id: string): string {
  return `https://youtu.be/${id}`;
}

/** 3725 → «1:02:05», 7 → «0:07»: the transcript's time format. */
function stamp(seconds: number): string {
  const total = Math.floor(seconds);
  const [h, m, s] = [
    Math.floor(total / 3600),
    Math.floor(total / 60) % 60,
    total % 60,
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** What Claude gets: the video's title, channel and chapters, then the transcript. */
export function summaryInput(info: VideoInfo, transcript: string): string {
  return [
    "<video>",
    `Title: ${info.title}`,
    ...(info.channel ? [`Channel: ${info.channel}`] : []),
    ...(info.chapters.length
      ? [
          "Chapters:",
          ...info.chapters.map((c) => `[${stamp(c.start)}] ${c.title}`),
        ]
      : []),
    "</video>",
    "<transcript>",
    transcript.trim(),
    "</transcript>",
  ].join("\n");
}

/** «[1:02:05]» → «[1:02:05](https://youtu.be/<id>?t=3725)»; a time already linked stays. */
export function linkTimes(md: string, id: string): string {
  return md.replace(/\[((?:\d+:)?\d+:\d\d)\](?!\()/g, (_, time: string) => {
    const seconds = time
      .split(":")
      .reduce((total, part) => total * 60 + Number(part), 0);
    return `[${time}](${videoUrl(id)}?t=${seconds})`;
  });
}

/** A level's .md file: title, level, channel and link, then Claude's reply with linked times. */
export function levelMarkdown(
  info: VideoInfo,
  id: string,
  level: keyof typeof LEVEL_NAMES,
  reply: string,
): string {
  const source = [info.channel, videoUrl(id)].filter(Boolean).join(" · ");
  return `# ${info.title}\n\n## ${LEVEL_NAMES[level]}\n\n${source}\n\n${linkTimes(reply.trim(), id)}\n`;
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

/** Asks Claude for one level of the summary of `transcript`; returns its reply. */
export function writeLevel(
  level: Level,
  info: VideoInfo,
  transcript: string,
  run: typeof runClaude = runClaude,
): Promise<string> {
  const prompt = fileURLToPath(new URL(`prompt-${level}.md`, import.meta.url));
  return run(prompt, summaryInput(info, transcript));
}
