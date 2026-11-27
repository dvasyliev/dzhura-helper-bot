import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LimitError,
  limitReset,
  modelOf,
  runClaude,
  usageOf,
} from "./claude.ts";

const now = new Date(2026, 10, 25, 10, 0, 0);
const MIN30 = 30 * 60 * 1000;

describe("limitReset", () => {
  it("is undefined for a normal result", () => {
    expect(
      limitReset({ is_error: false, result: "hello" }, now),
    ).toBeUndefined();
  });

  it("is undefined for an error that is not a limit", () => {
    expect(
      limitReset({ is_error: true, result: "Invalid API key" }, now),
    ).toBeUndefined();
  });

  it("reads the epoch of the pipe format", () => {
    const reset = limitReset(
      { is_error: true, result: "Claude AI usage limit reached|1764100800" },
      now,
    );
    expect(reset).toEqual(new Date(1764100800 * 1000));
  });

  it("reads a clock time today", () => {
    const reset = limitReset(
      { is_error: true, result: "You've hit your limit · resets 3pm" },
      now,
    );
    expect(reset).toEqual(new Date(2026, 10, 25, 15, 0, 0));
  });

  it("moves a clock time that has passed to tomorrow", () => {
    const reset = limitReset(
      { is_error: true, result: "You've hit your limit · resets 9:30am" },
      now,
    );
    expect(reset).toEqual(new Date(2026, 10, 26, 9, 30, 0));
  });

  it("waits 30 minutes when no reset is stated", () => {
    const reset = limitReset(
      { is_error: true, result: "Claude usage limit reached" },
      now,
    );
    expect(reset).toEqual(new Date(now.getTime() + MIN30));
  });
});

describe("usageOf", () => {
  it("reads the tokens and the cost of a reply", () => {
    expect(
      usageOf({
        usage: {
          input_tokens: 2,
          output_tokens: 13,
          cache_creation_input_tokens: 2555,
          cache_read_input_tokens: 100,
        },
        total_cost_usd: 0.01,
      }),
    ).toEqual({
      calls: 1,
      input: 2,
      output: 13,
      cacheWrite: 2555,
      cacheRead: 100,
      costUsd: 0.01,
    });
  });

  it("counts a reply without usage as one call with nothing", () => {
    expect(usageOf({})).toEqual({
      calls: 1,
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      costUsd: 0,
    });
  });
});

describe("modelOf", () => {
  it("is the model that wrote the most", () => {
    expect(
      modelOf({
        modelUsage: {
          "claude-haiku-4-5": { outputTokens: 20 },
          "claude-sonnet-4-5-20250929": { outputTokens: 900 },
        },
      }),
    ).toBe("claude-sonnet-4-5-20250929");
    expect(modelOf({})).toBeUndefined();
  });
});

describe("runClaude", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stops a claude that does not answer within timeoutMs", async () => {
    const bin = await mkdtemp(join(tmpdir(), "claude-bin-"));
    await writeFile(join(bin, "claude"), "#!/bin/sh\nexec sleep 30\n");
    await chmod(join(bin, "claude"), 0o755);
    vi.stubEnv("PATH", `${bin}:/usr/bin:/bin`);
    await expect(
      runClaude("prompt.md", "hi", undefined, { timeoutMs: 500 }),
    ).rejects.toThrow(/claude did not answer in 1 s/);
  });

  /** A fake claude that answers each run with the next script body; counts its runs in `count`. */
  async function fakeClaude(...answers: string[]) {
    const bin = await mkdtemp(join(tmpdir(), "claude-bin-"));
    const count = join(bin, "count");
    await writeFile(count, "");
    const cases = answers.map((a, i) => `${i + 1}) ${a} ;;`).join("\n");
    await writeFile(
      join(bin, "claude"),
      `#!/bin/sh\ncat >/dev/null\necho x >> "${count}"\nn=$(wc -l < "${count}" | tr -d ' ')\ncase $n in\n${cases}\nesac\n`,
    );
    await chmod(join(bin, "claude"), 0o755);
    vi.stubEnv("PATH", `${bin}:/usr/bin:/bin`);
    return async () =>
      (await readFile(count, "utf8")).split("\n").filter(Boolean).length;
  }
  const ok = `echo '{"is_error":false,"result":"done"}'`;
  const fail = `echo boom >&2; exit 1`;
  const limit = `echo '{"is_error":true,"result":"Claude usage limit reached|1764100800"}'`;

  it("retries a run that fails once", async () => {
    const runs = await fakeClaude(fail, ok);
    await expect(
      runClaude("p.md", "hi", undefined, { retryMs: 1 }),
    ).resolves.toBe("done");
    expect(await runs()).toBe(2);
  });

  it("gives up after one retry", async () => {
    const runs = await fakeClaude(fail, fail, ok);
    await expect(
      runClaude("p.md", "hi", undefined, { retryMs: 1 }),
    ).rejects.toThrow(/claude exited with 1/);
    expect(await runs()).toBe(2);
  });

  it("does not retry a usage limit", async () => {
    const runs = await fakeClaude(limit, ok);
    await expect(
      runClaude("p.md", "hi", undefined, { retryMs: 1 }),
    ).rejects.toBeInstanceOf(LimitError);
    expect(await runs()).toBe(1);
  });
});
