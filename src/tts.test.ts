import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  Object.assign(process.env, {
    BOT_TOKEN: "t",
    OWNER_ID: "42",
    FISH_API_KEY: "key",
    FISH_VOICE_ID: "voice",
    FISH_MODEL: "s2.1-pro-free",
  });
});

const audio = (bytes: number[]) => new Response(new Uint8Array(bytes), { status: 200 });
const busy = () => new Response("busy", { status: 503 });

describe("synthesize", () => {
  it("sends the text to Fish Audio with the voice, model and mp3 settings", async () => {
    const { synthesize } = await import("./tts.ts");
    const fetch = vi.fn(async () => audio([1, 2, 3]));
    const result = await synthesize("Привіт", { fetch, delayMs: 0 });

    expect([...result]).toEqual([1, 2, 3]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer key",
      "Content-Type": "application/json",
      model: "s2.1-pro-free",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Привіт",
      reference_id: "voice",
      format: "mp3",
      mp3_bitrate: 64,
    });
  });

  it("retries failed requests and succeeds", async () => {
    const { synthesize } = await import("./tts.ts");
    const fetch = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValue(audio([9]));
    expect([...(await synthesize("x", { fetch, delayMs: 0 }))]).toEqual([9]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last retry", async () => {
    const { synthesize } = await import("./tts.ts");
    const fetch = vi.fn(async () => busy());
    await expect(synthesize("x", { fetch, delayMs: 0, retries: 3 })).rejects.toThrow(/503/);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("synthesize without retries for account errors", () => {
  it.each([401, 402])("stops at once on %i and marks the error as fatal", async (status) => {
    const { synthesize, FatalTtsError } = await import("./tts.ts");
    const fetch = vi.fn(async () => new Response("no", { status }));
    await expect(synthesize("x", { fetch, delayMs: 0 })).rejects.toBeInstanceOf(FatalTtsError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
