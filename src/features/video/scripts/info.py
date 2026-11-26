"""Reads a YouTube video's metadata with yt-dlp, downloading nothing.

Reads a JSON job from stdin: {"id": YouTube video id}.
Prints one JSON line: {"title", "channel", "duration", "categories", "chapters": [{"start", "title"}], "language"}.
"""

import json
import sys

import yt_dlp


def main() -> None:
    job = json.load(sys.stdin)
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        meta = ydl.extract_info(f"https://www.youtube.com/watch?v={job['id']}", download=False) or {}
    chapters = [{"start": c["start_time"], "title": c["title"]} for c in meta.get("chapters") or []]
    info = {
        "title": meta.get("title") or job["id"],
        "channel": meta.get("channel"),
        "duration": meta.get("duration"),
        "categories": meta.get("categories") or [],
        "chapters": chapters,
        "language": meta.get("language"),
    }
    print(json.dumps({k: v for k, v in info.items() if v is not None}), flush=True)


if __name__ == "__main__":
    main()
