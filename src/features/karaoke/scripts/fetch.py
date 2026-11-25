"""Downloads a YouTube clip (≤720p mp4) and its metadata into the song's folder, named like the books: «Artist - Title»."""

import glob
import json
import os
import re

import yt_dlp

from lyrics import split_title

MAX_NAME_CHARS = 100  # like the books: readable names within file system limits


def song_name(meta: dict) -> str:
    """«Coldplay - Yellow», or the video title when the artist or track is unknown; safe as a file name."""
    name = f"{meta['artist']} - {meta['track']}" if meta["artist"] and meta["track"] else meta["title"]
    return re.sub(r'[/\\:*?"<>|]', "_", name).strip(". ")[:MAX_NAME_CHARS].strip()  # a leading «.» would hide the folder


# How karaoke channels label their videos, in the song's language: (music only, with vocals).
KARAOKE_LABELS = {
    "uk": ("Караоке", "Караоке з голосом"),
    "ru": ("Караоке", "Караоке с голосом"),
    "en": ("Karaoke Version", "Karaoke with Vocals"),
}


def video_name(meta: dict, language: str, vocals: bool) -> str:
    """«Шугар - Німесил (Караоке)», «Coldplay - Yellow (Karaoke with Vocals)»: the video's file name and title."""
    return f"{song_name(meta)} ({KARAOKE_LABELS[language][vocals]})"


def find_song(data_dir: str, video_id: str) -> str | None:
    """The folder of a clip fetched before, found by the YouTube id in its meta.json."""
    for meta_path in glob.glob(os.path.join(glob.escape(data_dir), "*", "meta.json")):
        with open(meta_path) as f:
            if json.load(f).get("id") == video_id:
                return os.path.dirname(meta_path)
    return None


def fetch(url: str, data_dir: str, video_id: str) -> tuple[str, dict]:
    """(song folder, meta). The folder holds clip.mp4 and meta.json; a clip fetched before is not downloaded again."""
    work_dir = find_song(data_dir, video_id)
    if work_dir and os.path.exists(os.path.join(work_dir, "clip.mp4")):
        with open(os.path.join(work_dir, "meta.json")) as f:
            return work_dir, json.load(f)
    # A known song missing its clip is downloaded again in place; a new one goes to a hidden folder until its name is known.
    tmp = work_dir or os.path.join(data_dir, f".{video_id}")
    os.makedirs(tmp, exist_ok=True)
    opts = {
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b",
        "outtmpl": os.path.join(tmp, "clip.%(ext)s"),
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    artist, track = info.get("artist") or info.get("creator"), info.get("track")
    if not (artist and track):
        artist, track = split_title(info.get("title") or "") or (None, None)
    meta = {
        "id": info["id"],
        "title": info.get("title"),
        "artist": artist,
        "track": track,
        "duration": info.get("duration"),
        "width": info.get("width"),
        "height": info.get("height"),
    }
    with open(os.path.join(tmp, "meta.json"), "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    if work_dir:
        return work_dir, meta
    work_dir = os.path.join(data_dir, song_name(meta))
    if os.path.exists(work_dir):  # another clip of the same song, e.g. a live version
        work_dir += f" ({video_id})"
    os.rename(tmp, work_dir)
    return work_dir, meta
