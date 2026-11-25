# Karaoke — design

## Intent

The owner sends a YouTube link to a music video. The bot returns the same clip as a
karaoke video: the lyrics appear on top of the clip and fill word by word as they
are sung. The look follows the owner's Youka videos. It is personal use on the
owner's Mac and fits into the existing feature menu as «🎤 Згенерувати караоке».

## Goals

- Songs in Ukrainian, Russian and English.
- The clip stays visible, slightly dimmed, with large bold lyrics on top that have
  an outline.
- Two lines on screen at once. The sung line fills with colour word by word, and the
  next line is already visible.
- A progress bar with 3‑2‑1 before the first line and after every pause longer than
  5 s.
- A small marker slides toward the first word of a phrase and disappears as singing
  starts.
- A title card («Artist — Title») over the intro.
- Audio choice per song: original with vocals, or music only (vocals removed).

## Non-goals (for now)

- Uploading to YouTube (planned later).
- Videos over 50 MB in Telegram. A local Bot API server is not set up; see
  «Output».
- A lyrics or timing editor. Fixes go through sending corrected text.
- Languages other than UA/RU/EN.

## Bot flow

1. The owner sends a YouTube link. The bot asks «З голосом / Без голосу» with
   buttons.
2. The bot starts a job through `jobs.ts`, so only one heavy job runs at a time. It
   posts progress: «Скачую…», «Відділяю голос…», «Шукаю текст…», «Синхронізую…»,
   «Рендерю…».
3. Lyrics are found and verified (see below), and the bot sends the video.
4. If no matching lyrics are found, the bot says so and offers two buttons:
   - **«Надішлю текст сам»**: the next text message is used as the lyrics, one line
     per line.
   - **«Зробити з розпізнаного»**: the bot builds karaoke from the Whisper
     transcript. It also sends the transcript as text, so the owner can fix it and
     send it back. A sent text re-runs the job from the «Синхронізую» step.

## Pipeline

All heavy work runs in Python scripts under `src/features/karaoke/scripts/`. They
are run through `uv` and talk to Node with JSON lines, the same way `voice.py` does.

| Step | Tool | Measured on «Саша», 2:41, M‑series |
|---|---|---|
| Download video+audio, 720p | `yt-dlp` | ~5 s |
| Separate vocals | `audio-separator`, model `vocals_mel_band_roformer.ckpt` | ~50 s |
| Detect language, transcribe vocals | Whisper (`mlx-whisper`) | not measured yet |
| Find lyrics | LRCLIB HTTP API | <1 s |
| Align words | `ctc-forced-aligner` (MMS model, romanized) | ~7 s |
| Build subtitles | our `.ass` generator | <1 s |
| Burn into clip | `ffmpeg` + `libass` | ~25 s |

### Lyrics: find, pick, verify

- **Artist and title** come from `yt-dlp` metadata (`artist`, `track`). If those are
  missing, they are parsed from the video title («Artist – Title», with
  «(Official Video)» and similar tags removed).
- **Search:** `GET https://lrclib.net/api/search?track_name=…&artist_name=…`. The
  free-text `q=` search fails on Cyrillic, which was verified.
- **Language** comes from Whisper's language detection on the vocal stem.
- **Picking a result:** keep results whose lyrics are in that language and whose
  duration is within ±10 s of the clip. «Саша» has both a Russian and a Ukrainian
  version on YouTube, so the language check matters. Lyrics language is judged by
  letters: `іїєґ` means UA, `ыэъё` means RU, Latin means EN.
- **Verifying:** compare the Whisper transcript with the lyrics by word overlap.
  Below a threshold (to be tuned on 5–10 songs), the lyrics count as not matching.
  Without this check, wrong lyrics still get «aligned» and show at the wrong times.
  This was seen with Ukrainian lyrics on the Russian clip.

### Alignment

- Align the whole song in one pass on the vocal stem. Use
  `star_frequency="segment"`, `romanize=True`, and `language` = `ukr`/`rus`/`eng`.
- **Sanity pass when LRCLIB gave timed lines:** compute the median offset between
  the aligned line starts and the LRC line starts. The offset is non-zero when the
  clip has a longer intro; it was +5.3 s on one clip. Re-align any line that is more
  than 1 s off that median, inside its own LRC window. On «Саша» this fixed the one
  bad line out of 49, and the result was within 0.45 s of LRC everywhere.
- LRCLIB timing is never used directly. It belongs to the album audio, not the clip.

### Rendering (ASS + ffmpeg)

- Canvas = clip size (720p). Background: `eq=brightness=-0.12:saturation=0.85`.
- Lyric style: Arial Bold, about 64 px at 720p. White unsung text, blue (`#1E90E0`)
  sung text, 3 px black outline, soft shadow. Two slots at the bottom, alternating.
- Word fill: `\kf` per word, with `\k` gaps between words.
- Countdown: a white bar with a blue fill grown through an animated `\clip`, and the
  digits 3‑2‑1 in the last 3 s. It shows before the first line and after any gap
  over 5 s, lasting up to 8 s.
- Marker: a blue bar drawn with `\move` from 140 px left of the line to just before
  its first word, over 1.5 s, ending at the first word's start. It shows when the
  gap before the line is at least 1 s. Text width comes from Pillow with the same
  font, converted to ASS font units.
- Audio: the original track, or the separator's «other» stem when vocals are off.

### Output

- `mp4`, H.264 + AAC, `-movflags +faststart`, sent with `sendVideo`.
- If the file is over 50 MB, the video bitrate is computed from the duration so the
  file fits. If it still does not fit, the bot replies with the path on the Mac.

## Data layout

`data/karaoke/<youtube-id>/` holds `clip.mp4`, `stems/`, `meta.json` (artist,
title, language, chosen lyrics source), `lyrics.json`, `aligned.json`,
`karaoke.ass` and `karaoke-<vocals|music>.mp4`. Re-sending the same link reuses
finished steps.

## Dependencies

- Python (`pyproject.toml`):
  - `audio-separator[cpu]` and `audioread`. `audio-separator` 0.48 forgets to
    declare `audioread`.
  - `ctc-forced-aligner @ git+https://github.com/MahmoudAshraf97/ctc-forced-aligner.git@277720f`.
    The PyPI package with the same name is a different, English-only project.
  - `mlx-whisper`, `pillow` and `yt-dlp`.
- System:
  - `ffmpeg` with `libass`. Done: `homebrew-ffmpeg/ffmpeg` 9.1 at
    `/opt/homebrew/bin/ffmpeg`.
  - `deno`. Newer `yt-dlp` needs a JS runtime for YouTube and warns without one.
- Models are downloaded on first use: the separator model is ~900 MB, the MMS
  aligner ~1.2 GB, and Whisper ~1.5 GB.

## Risks and open questions

- Whisper language detection and transcription on singing are not measured yet.
  Check them first on 5–10 UA/RU/EN songs before building the bot part.
- Rap, heavy backing vocals and duet overlaps align worse. They are accepted for
  now.
- The «з розпізнаного» quality on Ukrainian singing may be poor, which is why the
  bot always sends the transcript back for fixing.

## Prototype

A working prototype (not in the repo) produced the reference video for «Саша».
It lives in the session scratchpad: `align_words.py` (full + sanity re-align) and
`render_ass.py` (style, countdown, marker). These will be moved into
`src/features/karaoke/scripts/` during implementation.
