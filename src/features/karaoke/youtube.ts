import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";

/** Uploads videos to the owner's YouTube channel as unlisted, into one playlist, over plain REST. */

export type YouTubeOptions = {
  clientId: string;
  clientSecret: string;
  playlistId: string;
  /** JSON: the refresh token and the id of every upload by its title. */
  storeFile: string;
  oauthUrl?: string;
  apiUrl?: string;
  /** Pause before retrying a failed playlist add. */
  retryMs?: number;
};

type Store = { refreshToken?: string; videos: Record<string, string> };

const SCOPE = "https://www.googleapis.com/auth/youtube";
/** YouTube rejects longer titles, and titles with «<» or «>». */
const MAX_TITLE = 100;
/** Tries at adding to the playlist: it sometimes fails right after an upload. */
const PLAYLIST_TRIES = 3;

export function youtube(options: YouTubeOptions) {
  const oauth = options.oauthUrl ?? "https://oauth2.googleapis.com";
  const api = options.apiUrl ?? "https://www.googleapis.com";
  /** One login shared by uploads that need it at the same time. */
  let login: Promise<string> | undefined;

  const load = (): Store => (existsSync(options.storeFile) ? JSON.parse(readFileSync(options.storeFile, "utf8")) : { videos: {} });
  /** Re-reads the store before writing, so uploads running side by side keep each other's changes. */
  const update = (change: (store: Store) => void) => {
    const store = load();
    change(store);
    writeFileSync(options.storeFile, JSON.stringify(store, null, 1));
  };

  async function token(form: Record<string, string>): Promise<Response> {
    return fetch(`${oauth}/token`, {
      method: "POST",
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...form }),
    });
  }

  /** An access token: from the saved refresh token, or by asking the owner to log in with a code. */
  async function accessToken(askLogin: (url: string, code: string) => Promise<unknown>): Promise<string> {
    const refreshToken = load().refreshToken;
    if (refreshToken) {
      const res = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
      if (res.ok) return (await res.json()).access_token;
    }
    login ??= deviceLogin(askLogin).finally(() => (login = undefined));
    return login;
  }

  async function deviceLogin(askLogin: (url: string, code: string) => Promise<unknown>): Promise<string> {
    const res = await fetch(`${oauth}/device/code`, { method: "POST", body: new URLSearchParams({ client_id: options.clientId, scope: SCOPE }) });
    if (!res.ok) throw new Error(`Google: ${await res.text()}`);
    const device = await res.json();
    await askLogin(device.verification_url, device.user_code);
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = device.interval * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      const poll = await token({ device_code: device.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
      const answer = await poll.json();
      if (poll.ok) {
        update((store) => (store.refreshToken = answer.refresh_token));
        return answer.access_token;
      }
      if (answer.error === "slow_down") interval += 5000;
      else if (answer.error !== "authorization_pending") throw new Error(`Google: ${answer.error}`);
    }
    throw new Error("Google: expired_token");
  }

  async function call(url: string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`YouTube ${res.status}: ${await res.text()}`);
    return res;
  }

  /** An old copy that cannot be deleted stays; already gone (404) is fine. */
  async function deleteVideo(id: string, auth: Record<string, string>) {
    try {
      const res = await fetch(`${api}/youtube/v3/videos?id=${id}`, { method: "DELETE", headers: auth });
      if (!res.ok && res.status !== 404) console.error(`YouTube: could not delete ${id}: ${res.status} ${await res.text()}`);
    } catch (error) {
      console.error(`YouTube: could not delete ${id}:`, error);
    }
  }

  async function addToPlaylist(id: string, auth: Record<string, string>): Promise<boolean> {
    for (let attempt = 1; attempt <= PLAYLIST_TRIES; attempt++) {
      try {
        await call(`${api}/youtube/v3/playlistItems?part=snippet`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ snippet: { playlistId: options.playlistId, resourceId: { kind: "youtube#video", videoId: id } } }),
        });
        return true;
      } catch (error) {
        console.error(`YouTube: playlist add, try ${attempt}:`, error);
        if (attempt < PLAYLIST_TRIES) await new Promise((resolve) => setTimeout(resolve, options.retryMs ?? 3000));
      }
    }
    return false;
  }

  return {
    /** Uploads, adds to the playlist, replaces an earlier upload with the same title; resolves once the video is on the channel. */
    async publish(
      video: { file: string; title: string; description: string },
      askLogin: (url: string, code: string) => Promise<unknown>,
    ): Promise<{ url: string; inPlaylist: boolean }> {
      const auth = { authorization: `Bearer ${await accessToken(askLogin)}` };
      const title = [...video.title.replaceAll("<", "‹").replaceAll(">", "›")].slice(0, MAX_TITLE).join("");
      const size = statSync(video.file).size;
      const session = await call(`${api}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(size) },
        body: JSON.stringify({
          snippet: { title, description: video.description, categoryId: "10" },
          status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
        }),
      });
      const uploaded = await call(session.headers.get("location")!, {
        method: "PUT",
        headers: { ...auth, "content-type": "video/mp4", "content-length": String(size) },
        body: Readable.toWeb(createReadStream(video.file)) as ReadableStream,
        duplex: "half",
      } as RequestInit);
      const id: string = (await uploaded.json()).id;
      // The video is on the channel now: what follows must not turn this into a failure.
      const old = load().videos[video.title];
      update((store) => (store.videos[video.title] = id));
      if (old && old !== id) await deleteVideo(old, auth);
      return { url: `https://youtu.be/${id}`, inPlaylist: await addToPlaylist(id, auth) };
    },
  };
}
