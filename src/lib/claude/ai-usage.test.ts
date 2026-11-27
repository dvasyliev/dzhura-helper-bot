import type { Api } from "grammy";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  aiMeter,
  modelName,
  monthText,
  recordText,
  reportAi,
  spentText,
  type AiRecord,
} from "./ai-usage.ts";

vi.mock("../telegram/owner.ts", () => ({ ownerId: () => 7 }));

const usage = {
  calls: 2,
  input: 1000,
  output: 3200,
  cacheWrite: 19_000,
  cacheRead: 100_000,
  costUsd: 0.421,
};

const record: AiRecord = {
  at: "2026-11-26T18:00:00.000Z",
  what: "📋 Brief summary · Talk <1>",
  link: "https://t.me/c/1/2/3",
  model: "claude-sonnet-4-5-20250929",
  ms: 72_000,
  usage,
};

describe("formatting", () => {
  it("names the model and the time", () => {
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelName("claude-opus-4-1")).toBe("Opus 4.1");
    expect(modelName("other")).toBe("other");
  });

  it("shows an operation: what, its link, tokens and price, model and time", () => {
    expect(recordText(record)).toBe(
      [
        "📋 <b>Brief summary · Talk &lt;1&gt;</b>",
        "🔗 https://t.me/c/1/2/3",
        "🪙 120K in · 3.2K out 💵 ≈$0.42",
        "🤖 Sonnet 4.5 ⏱ 1 min 12 s",
      ].join("\n"),
    );
  });

  it("shows what a job spent: Claude's usage and the time, or the time alone", () => {
    expect(spentText(record)).toBe(
      "🪙 120K in · 3.2K out 💵 ≈$0.42\n🤖 Sonnet 4.5 ⏱ 1 min 12 s",
    );
    expect(spentText({ ms: 192_000 })).toBe("⏱ 3 min 12 s");
  });

  it("totals a month", () => {
    const old = { ...record, at: "2026-10-02T12:00:00.000Z" };
    expect(monthText([old, record, record], "2026-11")).toBe(
      [
        "📊 <b>AI in November 2026</b>",
        "2 operations ⏱ 2 min 24 s",
        "🪙 240K in · 6.4K out 💵 ≈$0.84",
      ].join("\n"),
    );
  });
});

describe("aiMeter", () => {
  it("sums the calls and notes the model and the time", () => {
    let now = 1000;
    const meter = aiMeter(() => now);
    meter.add(usage, "claude-sonnet-4-5");
    meter.add(usage);
    now = 6000;
    expect(meter.record("📝 Video description · X")).toEqual({
      what: "📝 Video description · X",
      model: "claude-sonnet-4-5",
      ms: 5000,
      usage: {
        ...usage,
        calls: 4,
        input: 2000,
        output: 6400,
        cacheWrite: 38_000,
        cacheRead: 200_000,
        costUsd: 0.842,
      },
    });
  });
});

describe("reportAi", () => {
  const fakeApi = () => ({
    sendMessage: vi.fn(async () => ({ message_id: 50 })),
    editMessageText: vi.fn(async () => true),
    pinChatMessage: vi.fn(async () => true),
  });
  const { at: _at, ...operation } = record;

  it("saves it, tells the owner and pins the month's total, then edits that total", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "ai-")), "ai-usage.json");
    const api = fakeApi();
    const now = new Date("2026-11-26T18:00:00.000Z");
    await reportAi(operation, { api: api as unknown as Api, file, now });
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      1,
      7,
      recordText(record),
      expect.anything(),
    );
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      2,
      7,
      expect.stringContaining("1 operations"),
      expect.anything(),
    );
    expect(api.pinChatMessage).toHaveBeenCalledWith(7, 50, {
      disable_notification: true,
    });

    await reportAi(operation, { api: api as unknown as Api, file, now });
    expect(api.pinChatMessage).toHaveBeenCalledTimes(1);
    expect(api.editMessageText).toHaveBeenCalledWith(
      7,
      50,
      expect.stringContaining("2 operations"),
      expect.anything(),
    );
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.records).toHaveLength(2);
    expect(saved.pins).toEqual({ "2026-11": 50 });
  });

  it("sends no message of its own when the job's status shows the usage", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "ai-")), "ai-usage.json");
    const api = fakeApi();
    await reportAi(operation, {
      api: api as unknown as Api,
      file,
      message: false,
    });
    expect(api.sendMessage).toHaveBeenCalledOnce();
    expect(api.sendMessage).toHaveBeenCalledWith(
      7,
      expect.stringContaining("1 operations"),
      expect.anything(),
    );
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.records).toHaveLength(1);
  });

  it("never throws", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "ai-")), "ai-usage.json");
    const api = fakeApi();
    api.sendMessage.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      reportAi(operation, { api: api as unknown as Api, file }),
    ).resolves.toBeUndefined();
  });
});
