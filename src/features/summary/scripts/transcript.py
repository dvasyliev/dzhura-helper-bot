"""Writes what a YouTube video says to transcript.txt: from subtitles made by people, or from Whisper when it has none.

YouTube's automatic subtitles are not used: Whisper hears better and keeps the punctuation.

Reads a JSON job from stdin: {"id": YouTube video id, "dir": folder to work in}.
Prints {"step": "whisper"} before listening with Whisper, then {"source": "subtitles" | "whisper"}.
transcript.txt has one line per ~30 seconds: «[m:ss] text».
"""

import glob
import json
import os
import sys
from typing import Any, cast

import yt_dlp

WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
LINE_SECONDS = 30


def stamp(seconds: float) -> str:
    """65 → «1:05», 3725 → «1:02:05»."""
    total = int(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def json3_lines(data: dict[str, Any]) -> list[tuple[float, str]]:
    """(start in seconds, text) of each YouTube json3 subtitle event that has words."""
    lines: list[tuple[float, str]] = []
    for event in data.get("events", []):
        text = " ".join("".join(seg.get("utf8", "") for seg in event.get("segs", [])).split())
        if text:
            lines.append((event.get("tStartMs", 0) / 1000, text))
    return lines


def group_lines(lines: list[tuple[float, str]]) -> list[str]:
    """Joins the lines into «[m:ss] text» lines, a new one every LINE_SECONDS."""
    result: list[str] = []
    start: float | None = None
    words: list[str] = []
    for at, text in lines:
        if start is not None and at - start >= LINE_SECONDS:
            result.append(f"[{stamp(start)}] {' '.join(words)}")
            start, words = None, []
        if start is None:
            start = at
        words.append(text)
    if start is not None:
        result.append(f"[{stamp(start)}] {' '.join(words)}")
    return result


def choose_subtitles(language: str | None, manual: dict[str, Any]) -> str | None:
    """The subtitle track to take: one in the video's language first, then any. «en-US» matches «en», «en-GB» and the
    rest."""
    if language:
        base = language.split("-")[0]
        for lang in manual:
            if lang.split("-")[0] == base:
                return lang
    return next(iter(manual), None)


def from_subtitles(url: str, work: str) -> list[str] | None:
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        meta = ydl.extract_info(url, download=False) or {}
    lang = choose_subtitles(meta.get("language"), meta.get("subtitles") or {})
    if not lang:
        return None
    # The typeshed stub types skip_download as str; yt-dlp takes a bool.
    with yt_dlp.YoutubeDL(
        {  # pyright: ignore[reportArgumentType]
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "skip_download": True,
            "writesubtitles": True,
            "subtitleslangs": [lang],
            "subtitlesformat": "json3",
            "outtmpl": os.path.join(work, "subtitles"),
        }
    ) as ydl:
        ydl.download([url])
    files = glob.glob(os.path.join(work, "subtitles*.json3"))
    if not files:
        return None
    with open(files[0], encoding="utf-8") as f:
        return group_lines(json3_lines(json.load(f))) or None


def from_whisper(url: str, work: str) -> list[str]:
    import mlx_whisper

    with yt_dlp.YoutubeDL(
        {
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "format": "bestaudio/best",
            "outtmpl": os.path.join(work, "audio.%(ext)s"),
        }
    ) as ydl:
        ydl.download([url])
    audio = glob.glob(os.path.join(work, "audio.*"))[0]
    try:
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=WHISPER_MODEL, verbose=None)
    finally:
        os.remove(audio)
    segments = cast(list[dict[str, Any]], result["segments"])
    return group_lines([(float(s["start"]), str(s["text"]).strip()) for s in segments if str(s["text"]).strip()])


def main() -> None:
    job = json.load(sys.stdin)
    work = job["dir"]
    os.makedirs(work, exist_ok=True)
    url = f"https://www.youtube.com/watch?v={job['id']}"
    lines = from_subtitles(url, work)
    source = "subtitles"
    if lines is None:
        print(json.dumps({"step": "whisper"}), flush=True)
        lines = from_whisper(url, work)
        source = "whisper"
    with open(os.path.join(work, "transcript.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(json.dumps({"source": source}), flush=True)


if __name__ == "__main__":
    main()
