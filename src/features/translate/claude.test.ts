import { describe, expect, it } from "vitest";
import { limitReset, usageOf } from "./claude.ts";

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
