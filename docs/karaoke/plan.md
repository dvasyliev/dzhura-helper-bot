# Karaoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner sends a YouTube link and gets back the clip as a karaoke video (Youka-style lyrics, countdowns, sliding marker), with or without vocals.

**Architecture:** One Python orchestrator, `src/features/karaoke/scripts/karaoke.py`, runs the pipeline: download, separate, listen, find lyrics, align, subtitles and render. Each step caches its output in the song's folder, `data/karaoke/<Artist - Title>/`, found again by the YouTube id in `meta.json`. The orchestrator reads a JSON job on stdin and prints JSON-line events. `src/features/karaoke/` (TypeScript) is the bot side. It spawns the orchestrator through `uv` like `audiobook/voice.ts` does, edits one status message, and handles the buttons.

**Tech Stack:** grammY, Vitest, Python 3.12 via uv, yt-dlp, audio-separator, mlx-whisper, ctc-forced-aligner, Pillow, ffmpeg with libass.

**Spec:** `docs/karaoke/design.md`

## Global Constraints

- Languages: `uk`, `ru` and `en` only. Whisper codes map to aligner codes `ukr`, `rus` and `eng`. Any other language stops the job with «Підтримую лише українську, російську й англійську пісні.»
- Separator model: `vocals_mel_band_roformer.ckpt`. Model files go in `data/karaoke/models`.
- Aligner: `ctc-forced-aligner @ git+https://github.com/MahmoudAshraf97/ctc-forced-aligner.git@277720ff832f6ec92bc97e32c7a6eda5dc466277`. Never use the PyPI `ctc-forced-aligner`.
- Whisper model: `mlx-community/whisper-large-v3-turbo`.
- LRCLIB: `GET https://lrclib.net/api/search?track_name=…&artist_name=…` (never `q=`). Duration tolerance is ±10 s.
- Lyrics language from letters: `іїєґ` means `uk`, `ыэъё` means `ru`, and mostly Latin means `en`.
- Alignment sanity: re-align a line when it is more than 1.0 s off the median LRC offset, inside the window `[lrc + offset − 1.0, next_lrc + offset + 0.5]`.
- Render: canvas is the clip size. Background filter `eq=brightness=-0.12:saturation=0.85`. Font Arial Bold (`/System/Library/Fonts/Supplemental/Arial Bold.ttf`), 64 px at 720p, scaled with the clip height. Sung colour `&H00E0901E&` (ASS BGR for `#1E90E0`), unsung white, outline 3 and shadow 2.
- Countdown when the gap is over 5.0 s. It lasts at most 8.0 s and shows the digits 3‑2‑1 in its last 3 s.
- Marker when the gap before the line is at least 1.0 s. It travels 1.5 s from 140 px left of the line to 16 px left of it.
- Output: H.264 + AAC 160k, `+faststart`. Above 49 MB, re-encode with video bitrate `(49 MiB × 8 / duration) − 160k`, times 0.95.
- Data layout: `data/karaoke/<Artist - Title>/` (or the YouTube title) holds `clip.mp4`, `meta.json` (with the YouTube id), `stems/`, `listen.json`, `мій текст.txt` (the owner's lyrics, reused), `lyrics.json`, `aligned.json`, `karaoke.ass`, `<Artist - Title> (Караоке).mp4` / `(Караоке з голосом).mp4` (labels by song language, see `KARAOKE_LABELS` in `fetch.py`).
- Bot copy is Ukrainian. Status steps: «Скачую…», «Відділяю голос…», «Слухаю…», «Шукаю текст…», «Синхронізую…», «Рендерю…».
- Python tests are plain-assert scripts, as in `audiobook/scripts/test_text.py`. Run them with `cd src/features/karaoke/scripts && uv run python test_karaoke.py`.

## Review Focus

- A lyric line wider than the frame (long English lines at 64 px) must shrink to fit, not run off screen. Covered by a test in Task 3.
- Singing that starts at 0–2 s: the countdown must not start before 0, and there is no title card. Covered by a test in Task 3.
- Link forms `youtu.be/ID`, `youtube.com/shorts/ID`, `music.youtube.com/watch?v=ID` and `…&list=…&index=10` must all give the video id. Covered by a test in Task 8.
- Lyrics the owner pastes with blank lines, `[Приспів]` or `[Chorus]` tags, or numbering: tags and blank lines are dropped. Covered by a test in Task 2.
- Wrong-language or wrong-song lyrics, such as the UA «Саша» lyrics on the RU clip `l2cwhjJXxCA`, must give `need_lyrics`, not a video. Checked in Task 7.

---

### Task 1: Dependencies and tooling

**Files:**
- Modify: `pyproject.toml`, `uv.lock`, `README.md` (setup section)

- [ ] **Step 1:** Add `audio-separator[cpu]>=0.48`, `audioread`, the pinned `ctc-forced-aligner` git URL, `mlx-whisper`, `pillow` and `yt-dlp` to `pyproject.toml`, then run `uv sync`.
- [ ] **Step 2:** Run `brew install deno`.
- [ ] **Step 3:** Verify with `uv run python -c "import audio_separator.separator, ctc_forced_aligner, mlx_whisper, yt_dlp, PIL; print('ok')"`, which should print `ok`. Also run `deno --version`, `ffmpeg -hide_banner -filters | grep ' ass '`, and the audiobook tests (`cd src/features/audiobook/scripts && uv run python test_numbers.py && uv run python test_text.py`), which should still pass.
- [ ] **Step 4:** In the README setup section, add one line about `brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg` and `deno`. Also note the first-run model downloads (separator ~900 MB, aligner ~1.2 GB, Whisper ~1.5 GB).
- [ ] **Step 5:** Commit `build: python deps for karaoke`.

### Task 2: `lyrics.py`: LRCLIB, language, choice, match

**Files:**
- Create: `src/features/karaoke/scripts/lyrics.py`, `src/features/karaoke/scripts/test_karaoke.py`

**Interfaces (produces):**
- `Line = TypedDict("Line", {"text": str, "lrc_start": float | None})`
- `parse_lrc(lrc: str) -> list[Line]`: drops empty lines.
- `parse_plain(text: str) -> list[Line]`: drops blank lines, `[...]` tag lines, and leading `1.` or `1)` numbering. Sets `lrc_start=None`.
- `text_language(text: str) -> str | None`: returns `"uk"`, `"ru"`, `"en"` or `None`.
- `split_title(video_title: str) -> tuple[str, str] | None`: turns «Artist – Title (Official Video)» into `(artist, title)`, accepting `-`, `–` and `—`, and dropping `(...)`/`[...]` tags and `| ...` tails.
- `search(artist: str, title: str) -> list[dict]`: LRCLIB results, with a 10 s timeout.
- `pick(results: list[dict], language: str, duration: float) -> dict | None`: prefers `syncedLyrics`, requires a matching language and a duration within ±10 s, and picks the closest duration.
- `match_score(lyrics: str, transcript: str) -> float`: the share of distinct lyrics words (lowercase letters only, length ≥ 3) found in the transcript words.

- [ ] **Step 1: Write failing tests** in `test_karaoke.py`:

```python
assert [l["text"] for l in parse_lrc("[00:14.33] Забудь все\n[00:20.65] Сльози\n[02:40.54]\n")] == ["Забудь все", "Сльози"]
assert parse_lrc("[01:02.55] З ним")[0]["lrc_start"] == 62.55
assert [l["text"] for l in parse_plain("[Приспів]\n1. Раз два\n\n[Chorus]\nТри чотири\n")] == ["Раз два", "Три чотири"]
assert text_language("Її запах на речах") == "uk"
assert text_language("Ты мой ёжик") == "ru"
assert text_language("Hello darkness my old friend") == "en"
assert split_title("VOLODYMYR DANTES – Саша (Official Video)") == ("VOLODYMYR DANTES", "Саша")
assert split_title("Artist - Song | Премьера клипа 2021") == ("Artist", "Song")
assert split_title("Просто назва") is None
uk = {"syncedLyrics": "[00:01.00] Її запах", "plainLyrics": "Її запах", "duration": 161.0}
ru = {"syncedLyrics": "[00:01.00] Её запах ты", "plainLyrics": "Её запах ты ёж", "duration": 161.0}
assert pick([ru, uk], "uk", 162.0) is uk
assert pick([uk], "uk", 175.0) is None
assert match_score("забудь все що було саша", "забудь все що було саша") == 1.0
assert match_score("забудь все що було саша", "hello world") == 0.0
```

- [ ] **Step 2:** Run `cd src/features/karaoke/scripts && uv run python test_karaoke.py`. Expected: ImportError.
- [ ] **Step 3:** Implement the interfaces above in `lyrics.py`. `search` uses `requests`, which is already a dependency.
- [ ] **Step 4:** Run the tests again. Expected: no output, exit 0.
- [ ] **Step 5:** Commit `feat(karaoke): lyrics lookup and matching`.

### Task 3: `subtitles.py`: Youka-style ASS

Port `render_ass.py` from the prototype (see the design's «Prototype»; its logic is described in the Global Constraints) into a pure function.

**Files:**
- Create: `src/features/karaoke/scripts/subtitles.py`
- Modify: `src/features/karaoke/scripts/test_karaoke.py`

**Interfaces (produces):**
- `Word = {"text": str, "start": float, "end": float}`, and an aligned line `= {"text": str, "words": list[Word]}`.
- `build_ass(lines: list[dict], width: int, height: int, title: str) -> str`.
- `ts(t: float) -> str`: ASS time `H:MM:SS.cc`, clamped at 0.

**Layout and timing rules (from the prototype):**
- Lines are grouped into blocks split by gaps over 5 s.
- Two alternating slots per block. A line shows from the start of the previous line in its block (the first two from the countdown start) and hides 0.6–0.8 s after its end, or when the line two after it needs the slot.
- The title card shows from 0.3 s to the countdown start − 0.2 s, only when the first countdown starts after 2.0 s.
- Lines wider than `width − 80` px (measured with Pillow) get `\fs` reduced so that they fit.

- [ ] **Step 1: Write failing tests:**

```python
w = lambda t, s, e: {"text": t, "start": s, "end": e}
song = [{"text": "Раз два", "words": [w("Раз", 14.5, 15.0), w("два", 15.2, 15.9)]},
        {"text": "Три", "words": [w("Три", 16.5, 17.0)]},
        {"text": "Після паузи", "words": [w("Після", 30.0, 30.5), w("паузи", 30.6, 31.0)]}]
ass = build_ass(song, 1280, 720, "Artist — Song")
assert ts(62.555) == "0:01:02.56" and ts(-1) == "0:00:00.00"
assert ass.count("\\clip(") == 2                     # two countdown bars: start + after the 13 s pause
assert "Artist — Song" in ass                        # title card: first countdown starts at 6.5 s
assert "\\kf50}Раз" in ass and "\\k20}" in ass       # word fill and the gap between words
assert "\\move(" in ass                              # marker before «Раз два»
early = build_ass([{"text": "Одразу", "words": [w("Одразу", 0.8, 1.5)]}], 1280, 720, "T")
assert "Dialogue: 1,0:00:00.00" in early and "T" not in early.split("[Events]")[1]
wide = build_ass([{"text": "дуже " * 30, "words": [w("дуже " * 30, 10, 20)]}], 1280, 720, "T")
assert "\\fs" in wide.split("[Events]")[1]
```

- [ ] **Step 2:** Run the tests. Expected: ImportError.
- [ ] **Step 3:** Implement `subtitles.py`. Font size is `round(64 * height / 720)`. The text-width helper converts the ASS size to a Pillow size with `size * 100 / (ascent + descent)` at size 100.
- [ ] **Step 4:** Run the tests. Expected: pass.
- [ ] **Step 5:** Commit `feat(karaoke): Youka-style ASS subtitles`.

### Task 4: `fetch.py` and `separate.py`

**Files:**
- Create: `src/features/karaoke/scripts/fetch.py`, `src/features/karaoke/scripts/separate.py`

**Interfaces (produces):**
- `fetch(url: str, work_dir: str) -> dict`: downloads `clip.mp4` (≤720p mp4 + m4a, `noplaylist=True`) through the `yt_dlp` Python API and writes and returns `meta.json`, which holds `{"id", "title", "artist", "track", "duration", "width", "height"}`. `artist`/`track` come from yt-dlp metadata, or from `split_title(title)`, or are `None`. If `clip.mp4` and `meta.json` already exist, it returns them without downloading.
- `separate(work_dir: str) -> tuple[str, str]`: returns `(vocals_wav, music_wav)` under `stems/`. It extracts `song.wav` (44.1 kHz stereo) with ffmpeg and runs `Separator(model_file_dir="data/karaoke/models", output_dir=stems)` with the pinned model. Cached.

- [ ] **Step 1:** Implement both.
- [ ] **Step 2:** Verify with `uv run python -c "from fetch import fetch; from separate import separate; m=fetch('https://youtu.be/B0bnhONb2kM','/tmp/k'); print(m); print(separate('/tmp/k'))"`, run from the scripts dir with the data dir passed as an absolute path. Expected: the meta shows `duration≈161`, and `ffmpeg -af volumedetect` on the vocals shows a mean above −30 dB. A second run returns instantly.
- [ ] **Step 3:** Commit `feat(karaoke): download and vocal separation`.

### Task 5: `listen.py`: language and transcript

**Files:**
- Create: `src/features/karaoke/scripts/listen.py`

**Interfaces (produces):**
- `listen(vocals_wav: str, work_dir: str) -> dict`: returns `{"language": str, "text": str, "lines": list[str]}` and caches it in `listen.json`. It uses `mlx_whisper.transcribe(path, path_or_hf_repo=WHISPER_MODEL)`, and the segment texts become `lines`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Spike on three clips. UA: «Саша» `B0bnhONb2kM`. RU: `l2cwhjJXxCA`. EN: any well-known English clip with lyrics on LRCLIB.
  - Print the language, the time taken, and `match_score(lrclib_lyrics, text)` for the right lyrics and for the UA lyrics against the RU clip.
  - Expected: the languages are `uk`, `ru`, `en`, and the right-lyrics score is clearly above the wrong one.
  - Set `MATCH_THRESHOLD` in `lyrics.py` halfway between the lowest right score and the highest wrong score, and write the measured numbers into the design's «Risks».
- [ ] **Step 3:** Commit `feat(karaoke): whisper language detection and transcript`.

### Task 6: `align.py`

Port `align_words.py` from the prototype.

**Files:**
- Create: `src/features/karaoke/scripts/align.py`

**Interfaces (produces):**
- `align(vocals_wav: str, lines: list[Line], language: str) -> list[dict]`: returns aligned lines in the Task 3 shape. It does a full pass (`romanize=True`, `star_frequency="segment"`, aligner language from the code map), followed by the sanity re-align from the Global Constraints, but only when every line has an `lrc_start`. It uses the `mps` device when available.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify on «Саша» with the LRCLIB lines. Expected: every line start is within 0.5 s of `lrc_start` plus the median offset, and the log says «Її запах на речах» was re-aligned.
- [ ] **Step 3:** Commit `feat(karaoke): word alignment`.

### Task 7: `render.py` and `karaoke.py` orchestrator

**Files:**
- Create: `src/features/karaoke/scripts/render.py`, `src/features/karaoke/scripts/karaoke.py`

**Interfaces (produces):**
- `render(work_dir: str, ass_path: str, audio: str, out: str, duration: float) -> str`: runs ffmpeg with the clip video plus `audio` (the original clip audio when `audio == "clip"`, otherwise a wav path), the background filter and `ass=`. It applies the 49 MB refit from the Global Constraints and returns `out`.
- `karaoke.py` stdin job: `{"url": str, "id": str, "vocals": bool, "data_dir": str, "lyrics_text": str | null, "use_transcript": bool}`.
- `karaoke.py` stdout events, one JSON per line:
  - `{"step": "download"|"separate"|"listen"|"lyrics"|"align"|"render"}`
  - `{"need_lyrics": "not_found"|"mismatch", "transcript": str}`
  - `{"video": str, "title": str, "duration": float, "width": int, "height": int}`
  - `{"error": str}`
- Lyrics choice in the orchestrator:
  - If `lyrics_text` is given, use `parse_plain`.
  - Else if `use_transcript` is set, use the Whisper `lines`.
  - Else search LRCLIB by `artist`/`track`. If nothing is found, retry with `split_title`. Then `pick`. If there is no pick, emit `not_found`. If the score is below `MATCH_THRESHOLD`, emit `mismatch`.
- Unsupported language: emit `{"error": "Підтримую лише українську, російську й англійську пісні."}`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run end to end on UA `B0bnhONb2kM` with `vocals: false`, on RU `l2cwhjJXxCA`, and on the EN clip from Task 5. Use `echo '<job>' | uv run python src/features/karaoke/scripts/karaoke.py`. Expected: a `video` event for each. Check the frames at the countdown, the first line and the marker the way the prototype was checked. In the music-only file, the audio track's mean volume must be within 2 dB of `stems/*other*` (the vocals are gone).
- [ ] **Step 3:** Commit `feat(karaoke): render and pipeline orchestrator`.

### Task 8: Bot feature

**Files:**
- Create: `src/features/karaoke/link.ts`, `src/features/karaoke/link.test.ts`, `src/features/karaoke/pipeline.ts`, `src/features/karaoke/index.ts`
- Modify: `src/features/index.ts` (replace the «скоро» karaoke stub with `karaoke`), `src/features/audiobook/index.ts` (the book-search text handler calls `next()` for texts with a newline or a URL)

**Interfaces:**
- `youtubeId(text: string): string | undefined` in `link.ts`.
- `runKaraoke(job: KaraokeJob): AsyncGenerator<KaraokeEvent>` in `pipeline.ts`. It spawns `uv run --quiet python src/features/karaoke/scripts/karaoke.py`, writes the job to stdin, yields parsed `{`-lines, and throws on a non-zero exit, like `voiceChapters`. `KaraokeJob` and `KaraokeEvent` mirror Task 7's job and events in camelCase on the TS side, mapped in `runKaraoke`.
- Bot state in `index.ts`:
  - `pending?: string` (the URL that waits for the vocals button).
  - `last?: { url: string; vocals: boolean }` (the last job, for lyrics re-runs).
- Handlers:
  - A text containing a YouTube link sets `pending` and replies «З голосом чи без?» with the buttons «🎤 З голосом» (`karaoke:vocals`) and «🎵 Лише музика» (`karaoke:music`).
  - A button press starts the job through `startJob("караоке", …)`. If busy, it says «Зачекайте, зараз триває …».
  - One status message is edited per `step`, using the copy in the Global Constraints.
  - `need_lyrics` replies «Не знайшов текст цієї пісні.» for `not_found`, or «Знайдений текст не збігається зі співом.» for `mismatch`. It adds the buttons «✍️ Надішлю текст сам» (`karaoke:mytext`) and «🤖 Зробити з розпізнаного» (`karaoke:transcript`).
  - `mytext` replies «Надішліть текст пісні, кожен рядок з нового рядка.»
  - `transcript` sends the transcript with «Розпізнаний текст. Виправте й надішліть — перероблю.» and runs with `useTranscript: true`.
  - A multi-line text while `last` is set re-runs with `lyricsText`.
  - `video` is sent with `sendVideo` (with width, height, duration and `supports_streaming`). If the send fails, the bot replies with the file path.
- Feature: `{ id: "karaoke", title: "🎤 Згенерувати караоке", hint: "Надішліть посилання на YouTube-кліп — зроблю з нього караоке.", composer }`.

- [ ] **Step 1: Write failing `link.test.ts`:**

```ts
expect(youtubeId("https://www.youtube.com/watch?v=SDVOzznI2zk&list=PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&index=10")).toBe("SDVOzznI2zk");
expect(youtubeId("глянь https://youtu.be/B0bnhONb2kM?si=x")).toBe("B0bnhONb2kM");
expect(youtubeId("https://youtube.com/shorts/l2cwhjJXxCA")).toBe("l2cwhjJXxCA");
expect(youtubeId("https://music.youtube.com/watch?v=B0bnhONb2kM")).toBe("B0bnhONb2kM");
expect(youtubeId("Дюна Герберт")).toBeUndefined();
```

- [ ] **Step 2:** Run `npx vitest run src/features/karaoke/link.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `link.ts`, `pipeline.ts` and `index.ts`, register the feature, and add the audiobook `next()` guard.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5:** Manual check in Telegram with `npm start`:
  - The UA link with music only gives a video.
  - The same link with vocals reuses the stems and is faster.
  - A link without lyrics on LRCLIB gives the two buttons.
  - A book title is still found by the audiobook search.
- [ ] **Step 6:** Commit `feat(karaoke): telegram feature`.

### Task 9: Docs

**Files:**
- Modify: `README.md` (the feature list and «Будова», plus a short «Як робиться караоке» section mirroring the audiobook one), `docs/karaoke/design.md` (mark the prototype section as moved to `scripts/`)

- [ ] **Step 1:** Update the docs, and add the Python test command for karaoke.
- [ ] **Step 2:** Commit `docs: karaoke`.
