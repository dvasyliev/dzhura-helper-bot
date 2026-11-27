import { createReadStream, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import pRetry from "p-retry";
import { z } from "zod";
import { readStore, type Store } from "../../lib/video/uploads.ts";

/** Uploads videos to the owner's YouTube channel as unlisted, into one playlist, over plain REST. */

export type YouTubeOptions = {
  clientId: string;
  clientSecret: string;
  playlistId: string;
  /** JSON: the refresh token and the id of every upload by its title. */
  storeFile: string;
  oauthUrl?: string;
  apiUrl?: string;
  /** Wait before the first retry of a failed playlist add; later ones wait longer. */
  minTimeout?: number;
};

const ACCESS = z.object({ access_token: z.string() });
const GRANTED = ACCESS.extend({ refresh_token: z.string() });
const FAILED = z.object({ error: z.string().optional() });
const DEVICE = z.object({
  verification_url: z.string(),
  user_code: z.string(),
  device_code: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});
const UPLOADED = z.object({ id: z.string() });

const SCOPE = "https://www.googleapis.com/auth/youtube";
/** YouTube rejects longer titles, and titles with «<» or «>». */
const MAX_TITLE = 100;
/** Retries of adding to the playlist: it sometimes fails right after an upload. */
const PLAYLIST_RETRIES = 2;
/** Longest wait for one Google request; the video upload gets longer. */
const REQUEST_MS = 60_000;
const UPLOAD_MS = 60 * 60_000;

export function youtube(options: YouTubeOptions) {
  const oauth = options.oauthUrl ?? "https://oauth2.googleapis.com";
  const api = options.apiUrl ?? "https://www.googleapis.com";
  /** One login shared by uploads that need it at the same time. */
  let login: Promise<string> | undefined;

  const load = (): Store => readStore(options.storeFile);
  /**
   * Re-reads the store before writing, so uploads running side by side keep each other's changes. It stays
   * synchronous on purpose: with no await between the read and the write, no other upload can change the file in between.
   */
  const update = (change: (store: Store) => void) => {
    const store = load();
    change(store);
    // Sync on purpose, see above: no await between the read and this write.
    writeFileSync(options.storeFile, JSON.stringify(store, null, 1));
  };

  async function token(form: Record<string, string>): Promise<Response> {
    return fetch(`${oauth}/token`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_MS),
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        ...form,
      }),
    });
  }

  /** An access token: from the saved refresh token, or by asking the owner to log in with a code. */
  async function accessToken(
    askLogin: (url: string, code: string) => Promise<unknown>,
  ): Promise<string> {
    const refreshToken = load().refreshToken;
    if (refreshToken) {
      const res = await token({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      if (res.ok) return ACCESS.parse(await res.json()).access_token;
    }
    login ??= deviceLogin(askLogin).finally(() => (login = undefined));
    return login;
  }

  async function deviceLogin(
    askLogin: (url: string, code: string) => Promise<unknown>,
  ): Promise<string> {
    const res = await fetch(`${oauth}/device/code`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_MS),
      body: new URLSearchParams({ client_id: options.clientId, scope: SCOPE }),
    });
    if (!res.ok) throw new Error(`Google: ${await res.text()}`);
    const device = DEVICE.parse(await res.json());
    await askLogin(device.verification_url, device.user_code);
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = device.interval * 1000;
    while (Date.now() < deadline) {
      await setTimeout(interval);
      const poll = await token({
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      if (poll.ok) {
        const granted = GRANTED.parse(await poll.json());
        update((store) => (store.refreshToken = granted.refresh_token));
        return granted.access_token;
      }
      const answer = FAILED.parse(await poll.json());
      if (answer.error === "slow_down") interval += 5000;
      else if (answer.error !== "authorization_pending")
        throw new Error(`Google: ${answer.error}`);
    }
    throw new Error("Google: expired_token");
  }

  async function call(
    url: string,
    init: RequestInit,
    timeoutMs = REQUEST_MS,
  ): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`YouTube ${res.status}: ${await res.text()}`);
    return res;
  }

  /** An old copy that cannot be deleted stays; already gone (404) is fine. */
  async function deleteVideo(id: string, auth: Record<string, string>) {
    try {
      const res = await fetch(`${api}/youtube/v3/videos?id=${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(REQUEST_MS),
        headers: auth,
      });
      if (!res.ok && res.status !== 404)
        console.error(
          `YouTube: could not delete ${id}: ${res.status} ${await res.text()}`,
        );
    } catch (error) {
      console.error(`YouTube: could not delete ${id}:`, error);
    }
  }

  async function addToPlaylist(
    id: string,
    auth: Record<string, string>,
  ): Promise<boolean> {
    try {
      await pRetry(
        () =>
          call(`${api}/youtube/v3/playlistItems?part=snippet`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({
              snippet: {
                playlistId: options.playlistId,
                resourceId: { kind: "youtube#video", videoId: id },
              },
            }),
          }),
        {
          retries: PLAYLIST_RETRIES,
          minTimeout: options.minTimeout ?? 3000,
          randomize: true,
          // A bad request or login fails the same way again; 404 and 409 happen while the new video is processed.
          shouldRetry: ({ error }) => {
            const status = /^YouTube (\d{3})/.exec(error.message)?.[1];
            return !(status === "400" || status === "401" || status === "403");
          },
          onFailedAttempt: ({ error, attemptNumber }) =>
            console.error(
              `YouTube: playlist add, try ${attemptNumber}:`,
              error,
            ),
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  return {
    /** Uploads, adds to the playlist, replaces an earlier upload with the same title; resolves once the video is on the channel. */
    async publish(
      video: { file: string; title: string; description: string },
      askLogin: (url: string, code: string) => Promise<unknown>,
    ): Promise<{ url: string; inPlaylist: boolean }> {
      const auth = { authorization: `Bearer ${await accessToken(askLogin)}` };
      const title = [...video.title.replaceAll("<", "‹").replaceAll(">", "›")]
        .slice(0, MAX_TITLE)
        .join("");
      const size = (await stat(video.file)).size;
      const session = await call(
        `${api}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
        {
          method: "POST",
          headers: {
            ...auth,
            "content-type": "application/json",
            "x-upload-content-type": "video/mp4",
            "x-upload-content-length": String(size),
          },
          body: JSON.stringify({
            snippet: {
              title,
              description: video.description,
              categoryId: "10",
            },
            status: {
              privacyStatus: "unlisted",
              selfDeclaredMadeForKids: false,
            },
          }),
        },
      );
      const uploaded = await call(
        session.headers.get("location")!,
        {
          method: "PUT",
          headers: {
            ...auth,
            "content-type": "video/mp4",
            "content-length": String(size),
          },
          body: Readable.toWeb(createReadStream(video.file)) as ReadableStream,
          duplex: "half",
        } as RequestInit,
        UPLOAD_MS,
      );
      const id = UPLOADED.parse(await uploaded.json()).id;
      // The video is on the channel now: what follows must not turn this into a failure.
      const old = load().videos[video.title];
      update((store) => (store.videos[video.title] = id));
      if (old && old !== id) await deleteVideo(old, auth);
      return {
        url: `https://youtu.be/${id}`,
        inPlaylist: await addToPlaylist(id, auth),
      };
    },
  };
}
