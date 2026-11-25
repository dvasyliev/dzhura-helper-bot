import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { youtube } from "./youtube.ts";

type Seen = { method: string; url: string; body: string };

/** A fake Google: OAuth on /oauth, the API on /api. `polls` answers device-code token polls in order. */
async function fakeGoogle(
  opts: {
    refresh?: "ok" | "invalid_grant";
    polls?: string[];
    deleteStatus?: number | "drop";
    playlistFails?: number;
  } = {},
) {
  let playlistFails = opts.playlistFails ?? 0;
  const seen: Seen[] = [];
  const polls = [...(opts.polls ?? ["ok"])];
  const server = createServer(async (req, res) => {
    const body = await read(req);
    const url = req.url!;
    seen.push({ method: req.method!, url, body });
    const json = (status: number, data: unknown) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(data));
    const form = new URLSearchParams(body);
    if (url === "/oauth/token" && form.get("grant_type") === "refresh_token") {
      return opts.refresh === "invalid_grant"
        ? json(400, { error: "invalid_grant" })
        : json(200, { access_token: "A" });
    }
    if (url === "/oauth/device/code") {
      return json(200, {
        device_code: "D",
        user_code: "ABCD-EFGH",
        verification_url: "https://www.google.com/device",
        expires_in: 1800,
        interval: 0,
      });
    }
    if (url === "/oauth/token") {
      const answer = polls.shift() ?? "ok";
      return answer === "ok"
        ? json(200, { access_token: "A", refresh_token: "R2" })
        : json(428, { error: answer });
    }
    if (
      req.method === "POST" &&
      url.startsWith("/api/upload/youtube/v3/videos?uploadType=resumable")
    ) {
      return res
        .writeHead(200, {
          location: `http://127.0.0.1:${port()}/api/session/1`,
        })
        .end();
    }
    if (req.method === "PUT" && url === "/api/session/1")
      return json(200, { id: "v1" });
    if (url.startsWith("/api/youtube/v3/playlistItems"))
      return playlistFails-- > 0
        ? json(503, { error: "backend" })
        : json(200, { id: "item" });
    if (
      req.method === "DELETE" &&
      url.startsWith("/api/youtube/v3/videos?id=")
    ) {
      return opts.deleteStatus === "drop"
        ? req.socket.destroy()
        : res.writeHead(opts.deleteStatus ?? 204).end();
    }
    json(404, { error: "unexpected" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = () => (server.address() as AddressInfo).port;
  servers.push(server);
  return { seen, base: `http://127.0.0.1:${port()}` };
}

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function setup(base: string, store: object) {
  const dir = mkdtempSync(path.join(tmpdir(), "youtube-"));
  const storeFile = path.join(dir, "youtube.json");
  writeFileSync(storeFile, JSON.stringify(store));
  const file = path.join(dir, "video.mp4");
  writeFileSync(file, "fake video");
  const yt = youtube({
    clientId: "C",
    clientSecret: "S",
    playlistId: "PL1",
    storeFile,
    oauthUrl: `${base}/oauth`,
    apiUrl: `${base}/api`,
    retryMs: 0,
  });
  return {
    yt,
    file,
    storeFile,
    stored: () => JSON.parse(readFileSync(storeFile, "utf8")),
  };
}

/** A store that already has a video titled «T», with its errors kept out of the test output. */
function replacingOld(base: string) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return setup(base, { refreshToken: "R", videos: { T: "old" } });
}

const noLogin = async () => {
  throw new Error("login not expected");
};

describe("youtube.publish", () => {
  it("uploads with a saved token, adds to the playlist and remembers the id", async () => {
    const google = await fakeGoogle();
    const { yt, file, stored } = setup(google.base, {
      refreshToken: "R",
      videos: {},
    });
    expect(
      await yt.publish(
        { file, title: "T", description: "Оригінал: x" },
        noLogin,
      ),
    ).toEqual({ url: "https://youtu.be/v1", inPlaylist: true });
    const insert = google.seen.find((r) => r.url.startsWith("/api/upload"))!;
    expect(JSON.parse(insert.body)).toMatchObject({
      snippet: { title: "T", description: "Оригінал: x" },
      status: { privacyStatus: "unlisted" },
    });
    expect(google.seen.find((r) => r.method === "PUT")!.body).toBe(
      "fake video",
    );
    const item = google.seen.find((r) =>
      r.url.startsWith("/api/youtube/v3/playlistItems"),
    )!;
    expect(JSON.parse(item.body).snippet).toMatchObject({
      playlistId: "PL1",
      resourceId: { kind: "youtube#video", videoId: "v1" },
    });
    expect(stored()).toEqual({ refreshToken: "R", videos: { T: "v1" } });
  });

  it("replaces the earlier upload with the same title", async () => {
    const google = await fakeGoogle();
    const { yt, file, stored } = setup(google.base, {
      refreshToken: "R",
      videos: { T: "old" },
    });
    await yt.publish({ file, title: "T", description: "" }, noLogin);
    expect(
      google.seen.some(
        (r) =>
          r.method === "DELETE" && r.url === "/api/youtube/v3/videos?id=old",
      ),
    ).toBe(true);
    expect(stored().videos.T).toBe("v1");
  });

  it("goes on when the earlier upload is already gone", async () => {
    const google = await fakeGoogle({ deleteStatus: 404 });
    const { yt, file } = setup(google.base, {
      refreshToken: "R",
      videos: { T: "old" },
    });
    await expect(
      yt.publish({ file, title: "T", description: "" }, noLogin),
    ).resolves.toMatchObject({ url: "https://youtu.be/v1" });
  });

  it.each([
    ["fails", 500],
    ["fails on the network", "drop"],
  ] as const)(
    "keeps the new upload when deleting the earlier one %s",
    async (_, deleteStatus) => {
      const google = await fakeGoogle({ deleteStatus });
      const { yt, file, stored } = replacingOld(google.base);
      await expect(
        yt.publish({ file, title: "T", description: "" }, noLogin),
      ).resolves.toMatchObject({ url: "https://youtu.be/v1" });
      expect(stored().videos.T).toBe("v1");
    },
  );

  it("asks to log in when the refresh token expired", async () => {
    const google = await fakeGoogle({
      refresh: "invalid_grant",
      polls: ["authorization_pending", "ok"],
    });
    const { yt, file, stored } = setup(google.base, {
      refreshToken: "R",
      videos: {},
    });
    const askLogin = vi.fn(async () => {});
    await yt.publish({ file, title: "T", description: "" }, askLogin);
    expect(askLogin).toHaveBeenCalledExactlyOnceWith(
      "https://www.google.com/device",
      "ABCD-EFGH",
    );
    expect(stored().refreshToken).toBe("R2");
  });

  it("one login for two uploads at once", async () => {
    const google = await fakeGoogle({ polls: ["authorization_pending", "ok"] });
    const { yt, file } = setup(google.base, { videos: {} });
    const askLogin = vi.fn(async () => {});
    await Promise.all([
      yt.publish({ file, title: "A", description: "" }, askLogin),
      yt.publish({ file, title: "B", description: "" }, askLogin),
    ]);
    expect(askLogin).toHaveBeenCalledOnce();
  });

  it("fails without touching the store when login is not finished", async () => {
    const google = await fakeGoogle({ polls: ["expired_token"] });
    const { yt, file, storeFile } = setup(google.base, {
      videos: { T: "old" },
    });
    const before = readFileSync(storeFile, "utf8");
    await expect(
      yt.publish({ file, title: "T", description: "" }, async () => {}),
    ).rejects.toThrow(/expired_token/);
    expect(readFileSync(storeFile, "utf8")).toBe(before);
  });

  it("retries the playlist add once it fails right after the upload", async () => {
    const google = await fakeGoogle({ playlistFails: 1 });
    const { yt, file } = setup(google.base, { refreshToken: "R", videos: {} });
    expect(
      await yt.publish({ file, title: "T", description: "" }, noLogin),
    ).toEqual({ url: "https://youtu.be/v1", inPlaylist: true });
  });

  it("still gives the link, remembers it and replaces the old copy when the playlist add keeps failing", async () => {
    const google = await fakeGoogle({ playlistFails: 99 });
    const { yt, file, stored } = replacingOld(google.base);
    expect(
      await yt.publish({ file, title: "T", description: "" }, noLogin),
    ).toEqual({ url: "https://youtu.be/v1", inPlaylist: false });
    expect(stored().videos.T).toBe("v1");
    expect(
      google.seen.some(
        (r) =>
          r.method === "DELETE" && r.url === "/api/youtube/v3/videos?id=old",
      ),
    ).toBe(true);
  });

  it("swaps the angle brackets YouTube rejects in titles", async () => {
    const google = await fakeGoogle();
    const { yt, file } = setup(google.base, { refreshToken: "R", videos: {} });
    await yt.publish({ file, title: "Song <3>", description: "" }, noLogin);
    const insert = google.seen.find((r) => r.url.startsWith("/api/upload"))!;
    expect(JSON.parse(insert.body).snippet.title).toBe("Song ‹3›");
  });

  it("cuts a long title to 100 characters", async () => {
    const google = await fakeGoogle();
    const { yt, file } = setup(google.base, { refreshToken: "R", videos: {} });
    await yt.publish(
      { file, title: "я".repeat(120), description: "" },
      noLogin,
    );
    const insert = google.seen.find((r) => r.url.startsWith("/api/upload"))!;
    expect(JSON.parse(insert.body).snippet.title).toHaveLength(100);
  });
});
