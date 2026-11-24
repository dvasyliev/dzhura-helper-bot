import { config } from "./config.ts";

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const ACCOUNT_ERRORS = [401, 402, 403];

/** The account cannot voice anything (bad key, no balance): stop the whole book. */
export class FatalTtsError extends Error {}

class HttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

type Options = { fetch?: typeof fetch; retries?: number; delayMs?: number };

/**
 * Voices `text` with Fish Audio and returns mp3 bytes. Network errors, 429 and 5xx are retried
 * `retries` times, waiting delayMs × attempt; other errors are thrown at once.
 */
export async function synthesize(text: string, opts: Options = {}): Promise<Buffer> {
  const { fetch: doFetch = fetch, retries = 3, delayMs = 2000 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs * attempt));
    try {
      const res = await doFetch(FISH_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.fishApiKey}`,
          "Content-Type": "application/json",
          model: config.fishModel,
        },
        body: JSON.stringify({ text, reference_id: config.fishVoiceId, format: "mp3", mp3_bitrate: 64 }),
      });
      if (!res.ok) {
        const message = `Fish Audio ${res.status}: ${(await res.text()).slice(0, 200)}`;
        if (ACCOUNT_ERRORS.includes(res.status)) throw new FatalTtsError(message);
        throw new HttpError(message, res.status === 429 || res.status >= 500);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      if (error instanceof FatalTtsError || (error instanceof HttpError && !error.retryable)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
