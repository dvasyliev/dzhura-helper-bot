import { spawn } from "node:child_process";
import pRetry from "p-retry";
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
  /** Tokens per model; the one that wrote the most is the reply's model. */
  modelUsage: z
    .record(z.string(), z.object({ outputTokens: z.number().optional() }))
    .optional(),
});
type Output = z.infer<typeof OUTPUT>;

/** Tokens and cost of Claude calls; `costUsd` is at API prices, which a subscription does not charge. */
export const USAGE = z.object({
  calls: z.number(),
  input: z.number(),
  output: z.number(),
  cacheWrite: z.number(),
  cacheRead: z.number(),
  costUsd: z.number(),
});
export type Usage = z.infer<typeof USAGE>;

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

/** The model that wrote most of a reply, e.g. «claude-sonnet-4-5-20250929». */
export function modelOf(output: Output): string | undefined {
  const models = Object.entries(output.modelUsage ?? {});
  models.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0));
  return models[0]?.[0];
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

/** Longest wait for one reply; a longer one is taken as hung. */
const TIMEOUT_MS = 20 * 60_000;

/** One `claude -p` run; a claude that does not answer within `timeoutMs` is killed and the run rejects. */
function attempt(
  promptFile: string,
  input: string,
  onUsage: ((usage: Usage, model?: string) => void) | undefined,
  model: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { ANTHROPIC_API_KEY: _key, ...env } = process.env;
    const child = spawn(
      "claude",
      [
        "-p",
        "--model",
        model,
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
    const timer = setTimeout(() => {
      reject(
        new Error(`claude did not answer in ${Math.round(timeoutMs / 1000)} s`),
      );
      child.kill("SIGKILL");
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    // A missing or early-exiting claude breaks the pipe; the error/close handlers reject.
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      let output: Output;
      try {
        output = OUTPUT.parse(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(
            `claude exited with ${code}, its output cannot be read (${error instanceof Error ? error.message : error}): ${(stderr || stdout).slice(0, 500)}`,
          ),
        );
        return;
      }
      onUsage?.(usageOf(output), modelOf(output));
      const reset = limitReset(output, new Date());
      if (reset) reject(new LimitError(reset));
      else if (output.is_error)
        reject(new Error(output.result ?? "claude returned an error"));
      else resolve(output.result ?? "");
    });
    child.stdin.end(input);
  });
}

/**
 * Runs `claude -p` with a system prompt file and `input` on stdin; returns the reply text and hands its usage and model
 * to `onUsage`; `model` defaults to sonnet. A failed run (exit, timeout, bad output) is tried once more after a short
 * random wait, each try with its own `timeoutMs`; a usage limit is never retried: the caller waits for its reset.
 */
export function runClaude(
  promptFile: string,
  input: string,
  onUsage?: (usage: Usage, model?: string) => void,
  {
    model = "sonnet",
    timeoutMs = TIMEOUT_MS,
    retryMs = 2000,
  }: { model?: string; timeoutMs?: number; retryMs?: number } = {},
): Promise<string> {
  return pRetry(() => attempt(promptFile, input, onUsage, model, timeoutMs), {
    retries: 1,
    minTimeout: retryMs,
    randomize: true,
    shouldRetry: ({ error }) => !(error instanceof LimitError),
  });
}
