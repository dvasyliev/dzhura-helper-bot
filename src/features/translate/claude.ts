import { spawn } from "node:child_process";
import { z } from "zod";

/** Thrown when Claude's usage limit is reached; `resetAt` is when to try again. */
export class LimitError extends Error {
  constructor(readonly resetAt: Date) {
    super(`Claude usage limit reached until ${resetAt.toISOString()}`);
    this.name = "LimitError";
  }
}

const OUTPUT = z.object({
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  total_cost_usd: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    })
    .optional(),
});
type Output = z.infer<typeof OUTPUT>;

/** Tokens and cost of Claude calls; `costUsd` is at API prices, which a subscription does not charge. */
export type Usage = {
  calls: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  costUsd: number;
};

/** The usage of one reply. */
export function usageOf(output: Output): Usage {
  const u = output.usage;
  return {
    calls: 1,
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    costUsd: output.total_cost_usd ?? 0,
  };
}

const LIMIT = /usage limit|hit your limit|limit reached/i;
const FALLBACK_WAIT_MS = 30 * 60 * 1000;

/** The time a usage-limit result says it resets, or 30 minutes from `now`; `undefined` if it is not a limit error. */
export function limitReset(output: Output, now: Date): Date | undefined {
  const text = output.result ?? "";
  if (!output.is_error || !LIMIT.test(text)) return undefined;
  const epoch = /\|(\d{9,})\s*$/.exec(text);
  if (epoch?.[1]) return new Date(Number(epoch[1]) * 1000);
  const clock = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  if (clock?.[1] && clock[3]) {
    const hour =
      (Number(clock[1]) % 12) + (clock[3].toLowerCase() === "pm" ? 12 : 0);
    const reset = new Date(now);
    reset.setHours(hour, Number(clock[2] ?? 0), 0, 0);
    if (reset <= now) reset.setDate(reset.getDate() + 1);
    return reset;
  }
  return new Date(now.getTime() + FALLBACK_WAIT_MS);
}

/** Runs `claude -p` with a system prompt file and `input` on stdin; returns the reply text and hands its usage to `onUsage`. */
export function runClaude(
  promptFile: string,
  input: string,
  onUsage?: (usage: Usage) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { ANTHROPIC_API_KEY: _key, ...env } = process.env;
    const child = spawn(
      "claude",
      [
        "-p",
        "--model",
        "sonnet",
        "--tools",
        "",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--system-prompt-file",
        promptFile,
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--setting-sources",
        "",
      ],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    // A missing or early-exiting claude breaks the pipe; the error/close handlers reject.
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      let output: Output;
      try {
        output = OUTPUT.parse(JSON.parse(stdout));
      } catch {
        reject(
          new Error(
            `claude exited with ${code}: ${(stderr || stdout).slice(0, 500)}`,
          ),
        );
        return;
      }
      onUsage?.(usageOf(output));
      const reset = limitReset(output, new Date());
      if (reset) reject(new LimitError(reset));
      else if (output.is_error)
        reject(new Error(output.result ?? "claude returned an error"));
      else resolve(output.result ?? "");
    });
    child.stdin.end(input);
  });
}
