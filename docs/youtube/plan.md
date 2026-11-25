# YouTube Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every finished karaoke is uploaded in full quality to the owner's YouTube channel as unlisted, added to the karaoke playlist, and its link is sent in Telegram.

**Architecture:** `render.py` keeps a full-quality file next to the Telegram one; the `video` event carries both paths. A new `src/features/karaoke/youtube.ts` does Google's device-flow login and the REST calls with plain `fetch`; the karaoke feature calls it after sending the video, outside the heavy-job lock.

**Tech Stack:** Python 3.12 + ffmpeg (render), TypeScript + grammY + vitest (bot), Google OAuth 2.0 device flow, YouTube Data API v3 REST.

**Spec:** [docs/youtube/design.md](design.md)

## Global Constraints

- No new npm or Python dependencies.
- Privacy `unlisted`; playlist `PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`; scope `https://www.googleapis.com/auth/youtube`.
- Credentials: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from `.env`; if either is missing the bot skips the upload silently.
- Token and uploaded-video map live in `data/youtube.json` (`{ refreshToken?: string, videos: { [title]: videoId } }`).
- Description: `Оригінал: https://www.youtube.com/watch?v=<clip id>`.
- Copy: `📺 Заливаю на YouTube…`; login: `Увійдіть у YouTube: відкрийте <verification_url> і введіть код <user_code>`; failure: `Не залив на YouTube: <reason>`.

## Review Focus

1. A title over 100 characters (YouTube's limit) is cut to 100, not rejected.
2. A revoked or 7-day-expired refresh token (`invalid_grant`) starts the device flow instead of failing.
3. The previous copy was deleted by hand on YouTube (DELETE → 404): the new upload still goes through.
4. Two uploads needing login at the same time show one code, not two.
5. Login not finished in time (`expired_token` / `access_denied`): the upload fails with a message, the Telegram video stays, the store is unchanged.

---

### Task 1: Full-quality render

**Files:**
- Modify: `src/features/karaoke/scripts/render.py`, `src/features/karaoke/scripts/karaoke.py`, `src/features/karaoke/pipeline.ts`
- Test: `src/features/karaoke/scripts/test_karaoke.py`

**Interfaces:**
- Produces: `render(...) -> tuple[str, str]` = (Telegram file, full file). Telegram file is `<name>.mp4`; when the crf 22 encode is over `LIMIT`, it is first renamed to `<name> (HQ).mp4` and the refit goes to `<name>.mp4`; otherwise both paths are the same file. The `video` event gets `"full": <path>`; `KaraokeEvent` video variant gets `full: string`.

- [ ] **Step 1:** In the existing apostrophe render test, unpack `out, full = render(...)` and assert `out == full`. Add a case with `render.LIMIT = 1` (restore after): assert `out != full`, both exist, `full.endswith(" (HQ).mp4")`.
- [ ] **Step 2:** Run `cd src/features/karaoke/scripts && uv run python test_karaoke.py` — expect a failure (render returns a str).
- [ ] **Step 3:** Implement in `render.py`; `karaoke.py` emits `full`; add `full: string` to the type in `pipeline.ts`.
- [ ] **Step 4:** Python tests pass; `npm run typecheck` passes.
- [ ] **Step 5:** Commit `feat(karaoke): keep a full-quality render for YouTube`.

### Task 2: `youtube.ts`

**Files:**
- Create: `src/features/karaoke/youtube.ts`
- Test: `src/features/karaoke/youtube.test.ts` (a fake Google on `node:http` at `127.0.0.1:<random port>`)

**Interfaces:**
- Produces:
  ```ts
  export type YouTubeOptions = {
    clientId: string; clientSecret: string; playlistId: string; storeFile: string;
    oauthUrl?: string;   // default "https://oauth2.googleapis.com"
    apiUrl?: string;     // default "https://www.googleapis.com"
  };
  export function youtube(options: YouTubeOptions): {
    /** Uploads, adds to the playlist, replaces an earlier upload with the same title; returns "https://youtu.be/<id>". */
    publish(video: { file: string; title: string; description: string }, askLogin: (url: string, code: string) => Promise<unknown>): Promise<string>;
  };
  ```
- Calls: `POST {oauth}/token` (refresh_token grant); `POST {oauth}/device/code`, then poll `POST {oauth}/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` every `interval` s (`authorization_pending` → wait, `slow_down` → interval + 5 s, anything else → throw); `POST {api}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` → `Location`, then `PUT` the file stream; `POST {api}/youtube/v3/playlistItems?part=snippet`; `DELETE {api}/youtube/v3/videos?id=<old>`.
- Upload body: `snippet: { title, description, categoryId: "10" }`, `status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false }`.
- The fake server answers `interval: 0` so tests don't wait.

- [ ] **Step 1: Tests**
  - `uploads with a saved token, adds to the playlist and remembers the id` — store has `refreshToken`; returns `https://youtu.be/v1`; the server saw upload with `privacyStatus: "unlisted"`, playlistItems with the playlist id; store `videos["T"] === "v1"`.
  - `replaces the earlier upload with the same title` — store `videos: { T: "old" }`; DELETE `id=old` seen; store `videos.T === "v1"`.
  - `goes on when the earlier upload is already gone` — DELETE answers 404; publish resolves.
  - `asks to log in when the refresh token expired` — refresh answers `400 {error:"invalid_grant"}`; `askLogin` called once with (`https://www.google.com/device`, `ABCD-EFGH`); the first token poll answers `authorization_pending`, the second succeeds with a new refresh token; store has the new token.
  - `one login for two uploads at once` — no token; two `publish` in parallel; `askLogin` called once.
  - `fails without touching the store when login is not finished` — poll answers `expired_token`; publish rejects; store file unchanged.
  - `cuts a long title to 100 characters` — title of 120 chars; uploaded title length 100.
- [ ] **Step 2:** `npx vitest run src/features/karaoke/youtube.test.ts` — fails (module missing).
- [ ] **Step 3:** Implement. One in-flight login promise shared by concurrent `publish` calls; store read at start of each `publish` and written after success.
- [ ] **Step 4:** Tests pass; `npm test` and `npm run typecheck` pass.
- [ ] **Step 5:** Commit `feat(karaoke): youtube upload with device-flow login`.

### Task 3: «Два варіанти»

Owner's request: a third choice that makes both the music-only and the with-vocals karaoke from one link; buttons named like the video labels.

**Files:**
- Modify: `src/features/karaoke/scripts/karaoke.py`, `src/features/karaoke/pipeline.ts`, `src/features/karaoke/index.ts`
- Test: `src/features/karaoke/scripts/test_karaoke.py`

**Interfaces:**
- Produces: `KaraokeJob.versions: ("music" | "vocals")[]` replaces `vocals: boolean` (JSON `versions`); `karaoke.py` aligns once and renders each version in order, emitting one `video` event per version. `last` keeps `versions`, so a lyrics re-run remakes the same versions.
- Buttons (one row): `🎵 Караоке` (`karaoke:music`), `🎤 З голосом` (`karaoke:vocals`), `🎵🎤 Два варіанти` (`karaoke:both`). Question: `Яку версію зробити? Займе ≈1 хв` / `≈2–3 хв` (unchanged rule).

- [ ] **Step 1:** Python test: a pure helper `outputs(meta, language, versions) -> list[tuple[str, bool]]` in `karaoke.py` returns `[("<name> (Караоке)", False), ("<name> (Караоке з голосом)", True)]` for `["music", "vocals"]`, in the order given.
- [ ] **Step 2:** Run Python tests — fails (no `outputs`).
- [ ] **Step 3:** Implement `outputs`, the render loop, `versions` in `pipeline.ts`/`index.ts`, the third button.
- [ ] **Step 4:** Python tests, `npm test`, `npm run typecheck` pass.
- [ ] **Step 5:** Commit `feat(karaoke): both versions from one link`.

### Task 4: Wire into the bot, docs

**Files:**
- Modify: `src/config.ts` (optional `googleClientId`, `googleClientSecret`), `src/features/karaoke/index.ts`, `README.md`, `.env.example` (if present)

**Interfaces:**
- Consumes: `youtube()` from Task 2; `full` from Task 1.

- [ ] **Step 1:** In `follow()`, send the Telegram file with `InputFile(video, path.basename(full))` (so the HQ suffix never shows); after a successful `sendVideo`, `void toYouTube(ctx, chatId, event, job)` — not awaited, so the job lock is released. `toYouTube`: skip when creds are missing; send `📺 Заливаю на YouTube…`; `publish({ file: full, title, description: "Оригінал: " + job.url })` with `askLogin` sending the login copy; edit the status to the link; on error edit it to `Не залив на YouTube: <message>`.
- [ ] **Step 2:** README: a short «YouTube» section (what happens, weekly login by code, where the token lives).
- [ ] **Step 3:** `npm test`, `npm run typecheck`, Python tests pass.
- [ ] **Step 4:** Commit `feat(karaoke): upload every karaoke to YouTube`.
- [ ] **Step 5:** Check `pgrep -fl "karaoke.py|voice.py"` is empty, restart the bot, make one karaoke end-to-end, log in by code, confirm the video is in the playlist.
