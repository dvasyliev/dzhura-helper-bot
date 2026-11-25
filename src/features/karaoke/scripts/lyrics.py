"""Song lyrics: LRCLIB lookup, picking the right version, and checking it matches what is sung."""

import os
import re
import sys
from typing import TypedDict

import requests

LRCLIB = "https://lrclib.net/api/search"
DURATION_TOLERANCE = 10.0
# Share of lyrics words heard in the Whisper transcript below which the lyrics are taken as another song or version.
MATCH_THRESHOLD = 0.37  # measured: right lyrics 0.59 (uk), 0.75 (ru), 0.98 (en); UA lyrics on the RU clip 0.15


class Line(TypedDict):
    text: str
    lrc_start: float | None


def parse_lrc(lrc: str) -> list[Line]:
    """Timed lines in time order; «[00:10.00][01:20.00] text» repeats the line at each stamp."""
    lines: list[Line] = []
    for m in re.finditer(r"^((?:\[\d+:\d+(?:\.\d+)?\])+)[ \t]*(.*)$", lrc, re.M):
        text = m.group(2).strip()
        for minutes, seconds in re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", m.group(1)):
            if text:
                lines.append({"text": text, "lrc_start": round(int(minutes) * 60 + float(seconds), 3)})
    return sorted(lines, key=lambda line: line["lrc_start"] or 0.0)  # always set for LRC lines


SECTION = re.compile(
    r"\(?(приспів|куплет|бридж|програш|припев|chorus|verse|bridge|pre-chorus|intro|outro)( ?\d+)?( ?x ?\d+)?\)?:?", re.I
)


def parse_plain(text: str) -> list[Line]:
    """Lyrics typed or pasted by the owner: one line per line; labels like «[Приспів]», «Куплет 2:» and numbering are dropped."""
    lines: list[Line] = []
    for raw in text.splitlines():
        line = re.sub(r"^\s*\d+[.)]\s*", "", raw).strip()
        if line and not re.fullmatch(r"\[.*\]", line) and not SECTION.fullmatch(line):
            lines.append({"text": line, "lrc_start": None})
    return lines


OWN_LYRICS = "мій текст.txt"


def own_lyrics(work_dir: str, lyrics_text: str | None, use_transcript: bool, heard_lines: list[str]) -> str | None:
    """Lyrics the owner sent or chose from the transcript; kept in the song's folder (and editable there) for later runs."""
    path = os.path.join(work_dir, OWN_LYRICS)
    if lyrics_text or use_transcript:
        with open(path, "w") as f:
            f.write(lyrics_text or "\n".join(heard_lines))
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return f.read()


def text_language(text: str) -> str | None:
    lower = text.lower()
    if re.search(r"[іїєґ]", lower):
        return "uk"
    if re.search(r"[ыэъё]", lower):
        return "ru"
    latin = len(re.findall(r"[a-z]", lower))
    cyrillic = len(re.findall(r"[а-я]", lower))
    return "en" if latin > cyrillic else None


def split_title(video_title: str) -> tuple[str, str] | None:
    """«Artist – Title (Official Video)» → ("Artist", "Title")."""
    title = re.sub(r"[(\[].*?[)\]]", "", video_title.split("|")[0])
    parts = re.split(r"\s+[-–—]\s+", title, maxsplit=1)
    if len(parts) != 2:
        return None
    artist, song = (p.strip() for p in parts)
    return (artist, song) if artist and song else None


def search(artist: str, title: str) -> list[dict]:
    """LRCLIB results; none when it is unreachable, so the owner gets the lyrics buttons instead of an error."""
    try:
        res = requests.get(
            LRCLIB,
            params={"track_name": title, "artist_name": artist},
            headers={"User-Agent": "dzhura-helper-bot karaoke (personal)"},
            timeout=10,
        )
        res.raise_for_status()
        return res.json()
    except requests.RequestException as error:
        print(f"LRCLIB: {error}", file=sys.stderr)
        return []


def pick(results: list[dict], language: str, duration: float) -> dict | None:
    """The result in `language` closest in duration (within ±10 s), synced lyrics first."""
    fitting = [
        r
        for r in results
        if text_language(r.get("plainLyrics") or r.get("syncedLyrics") or "") == language
        and r.get("duration") is not None
        and abs(r["duration"] - duration) <= DURATION_TOLERANCE
    ]
    fitting.sort(key=lambda r: (not r.get("syncedLyrics"), abs(r["duration"] - duration)))
    return fitting[0] if fitting else None


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[^\W\d_]+", text.lower()) if len(w) >= 3}


def match_score(lyrics: str, transcript: str) -> float:
    words = _words(lyrics)
    return len(words & _words(transcript)) / len(words) if words else 0.0
