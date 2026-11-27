"""Downloads a YouTube clip (≤720p mp4) and its metadata into the song's folder, named like the books: «Artist - Title»."""

import glob
import json
import os
import re
from pathlib import Path

import yt_dlp
from pydantic import BaseModel

from dzhura_helper_bot.karaoke.lyrics import split_title
from dzhura_helper_bot.shared.youtube import YOUTUBE_OPTIONS

MAX_NAME_CHARS = 100  # like the books: readable names within file system limits


class Meta(BaseModel):
    """What meta.json holds about a clip."""

    id: str
    title: str | None = None
    artist: str | None = None
    track: str | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None


def song_name(meta: dict) -> str:
    """«Coldplay - Yellow», or the video title when the artist or track is unknown; safe as a file name."""
    name = f"{meta['artist']} - {meta['track']}" if meta["artist"] and meta["track"] else meta["title"]
    return (
        re.sub(r'[/\\:*?"<>|]', "_", name).strip(". ")[:MAX_NAME_CHARS].strip()
    )  # a leading «.» would hide the folder


def video_name(meta: dict, vocals: bool) -> str:
    """«Coldplay - Yellow (Karaoke)», «Coldplay - Yellow (Vocals)»: the video's file name and title, like the buttons."""
    return f"{song_name(meta)} ({'Vocals' if vocals else 'Karaoke'})"


def outputs(meta: dict, versions: list[str]) -> list[tuple[str, bool]]:
    """(video name, with vocals) for each asked version ("music" or "vocals"), in the order asked."""
    return [(video_name(meta, v == "vocals"), v == "vocals") for v in versions]


def find_song(data_dir: str, video_id: str) -> str | None:
    """The folder of a clip fetched before, found by the YouTube id in its meta.json."""
    for meta_path in glob.glob(os.path.join(glob.escape(data_dir), "*", "meta.json")):
        if json.loads(Path(meta_path).read_text(encoding="utf-8")).get("id") == video_id:
            return os.path.dirname(meta_path)
    return None


def fetch(url: str, data_dir: str, video_id: str) -> tuple[str, dict]:
    """(song folder, meta). The folder holds clip.mp4 and meta.json; a clip fetched before is not downloaded again."""
    work_dir = find_song(data_dir, video_id)
    if work_dir and os.path.exists(os.path.join(work_dir, "clip.mp4")):
        meta_json = Path(work_dir, "meta.json").read_text(encoding="utf-8")
        return work_dir, Meta.model_validate_json(meta_json).model_dump()
    # A known song missing its clip is downloaded again in place; a new one goes to a hidden folder until its name is known.
    tmp = work_dir or os.path.join(data_dir, f".{video_id}")
    os.makedirs(tmp, exist_ok=True)
    with yt_dlp.YoutubeDL(
        {
            "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b",
            "outtmpl": os.path.join(tmp, "clip.%(ext)s"),
            "merge_output_format": "mp4",
            "noplaylist": True,
            **YOUTUBE_OPTIONS,
            "noprogress": True,
        }
    ) as ydl:
        info = ydl.extract_info(url, download=True)
    artist, track = info.get("artist") or info.get("creator"), info.get("track")
    if not (artist and track):
        artist, track = split_title(info.get("title") or "") or (None, None)
    meta = Meta(
        id=info["id"],
        title=info.get("title"),
        artist=artist,
        track=track,
        duration=info.get("duration"),
        width=info.get("width"),
        height=info.get("height"),
    ).model_dump()
    with open(os.path.join(tmp, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    if work_dir:
        return work_dir, meta
    work_dir = os.path.join(data_dir, song_name(meta))
    if os.path.exists(work_dir):  # another clip of the same song, e.g. a live version
        work_dir += f" ({video_id})"
    os.rename(tmp, work_dir)
    return work_dir, meta
