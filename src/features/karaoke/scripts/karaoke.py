"""Makes a karaoke video from a YouTube clip.

Reads a JSON job from stdin:
  {"url": "https://youtu.be/B0bnhONb2kM", "id": "B0bnhONb2kM", "versions": ["music", "vocals"], "data_dir": "data/karaoke",
   "lyrics_text": null, "use_transcript": false}
Steps cache their output in the song's folder, <data_dir>/<Artist - Title>/ (found again by the id), so a second run of the same clip only redoes what changed.
Prints JSON lines: {"step": "download"|"separate"|"listen"|"lyrics"|"align"|"render"} as each starts;
then a {"video": path, "full": full-quality path, "title", "duration", "width", "height"} per version in order, or
{"need_lyrics": "not_found"|"mismatch", "transcript": "..."} or {"error": "..."}.
Usage: echo '<job>' | uv run python src/features/karaoke/scripts/karaoke.py
"""

import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

from align import ALIGNER_LANGUAGE, align  # noqa: E402
from countin import SOON, count_in, delay  # noqa: E402
from fetch import fetch, outputs  # noqa: E402
from listen import listen  # noqa: E402
from lyrics import (
    MATCH_THRESHOLD,
    match_score,
    own_lyrics,
    parse_lrc,
    parse_plain,
    pick,
    search,
    split_title,
    text_language,
)  # noqa: E402
from render import render  # noqa: E402
from subtitles import build_ass  # noqa: E402

UNSUPPORTED = "Підтримую лише українську, російську й англійську пісні."

events = sys.stdout
sys.stdout = sys.stderr  # libraries that print must not mix into the events


def emit(event: dict) -> None:
    events.write(json.dumps(event, ensure_ascii=False) + "\n")
    events.flush()


def find_lyrics(meta: dict, language: str) -> dict | None:
    """LRCLIB result for the clip: by its artist/track, then by «Artist – Title» from the video title."""
    tries = [(meta["artist"], meta["track"]), split_title(meta["title"] or "")]
    for artist, track in dict.fromkeys(t for t in tries if t and all(t)):
        found = pick(search(artist, track), language, meta["duration"])
        if found:
            return found
    return None


def run(job: dict) -> None:
    from separate import separate

    emit({"step": "download"})
    work, meta = fetch(job["url"], job["data_dir"], job["id"])
    emit({"step": "separate"})
    vocals_wav, music_wav = separate(work)
    emit({"step": "listen"})
    heard = listen(vocals_wav, work)
    own = own_lyrics(work, job.get("lyrics_text"), job.get("use_transcript", False), heard["lines"])
    language = (text_language(own) if own else None) or heard["language"]  # the owner's lyrics outrank Whisper's guess
    if language not in ALIGNER_LANGUAGE:
        return emit({"error": UNSUPPORTED})

    emit({"step": "lyrics"})
    if own:
        lines = parse_plain(own)
    else:
        found = find_lyrics(meta, language)
        if not found:
            return emit({"need_lyrics": "not_found", "transcript": "\n".join(heard["lines"])})
        if match_score(found.get("plainLyrics") or "", heard["text"]) < MATCH_THRESHOLD:
            return emit({"need_lyrics": "mismatch", "transcript": "\n".join(heard["lines"])})
        lines = parse_lrc(found["syncedLyrics"]) if found.get("syncedLyrics") else parse_plain(found["plainLyrics"])
    if not lines:
        return emit({"error": "Текст пісні порожній."})
    with open(os.path.join(work, "lyrics.json"), "w") as f:
        json.dump(lines, f, ensure_ascii=False, indent=1)

    emit({"step": "align"})
    aligned = align(vocals_wav, lines, language)
    with open(os.path.join(work, "aligned.json"), "w") as f:
        json.dump(aligned, f, ensure_ascii=False, indent=1)

    emit({"step": "render"})
    title = f"{meta['artist']} — {meta['track']}" if meta["artist"] and meta["track"] else meta["title"]
    first_word = aligned[0]["words"][0]["start"]
    pause, beats = count_in(music_wav, first_word) if first_word < SOON else (0.0, None)
    duration = meta["duration"] + pause
    ass_path = os.path.join(work, "karaoke.ass")
    with open(ass_path, "w") as f:
        f.write(build_ass(delay(aligned, pause), meta["width"], meta["height"], title, beats))
    for name, vocals in outputs(meta, language, job["versions"]):
        out, full = render(
            work, ass_path, "clip" if vocals else music_wav, os.path.join(work, f"{name}.mp4"), duration, pause
        )
        emit(
            {
                "video": out,
                "full": full,
                "title": title,
                "duration": duration,
                "width": meta["width"],
                "height": meta["height"],
            }
        )


if __name__ == "__main__":
    try:
        run(json.load(sys.stdin))
    except Exception as error:  # noqa: BLE001 — the bot shows the reason to the owner
        emit({"error": f"{type(error).__name__}: {error}"})
