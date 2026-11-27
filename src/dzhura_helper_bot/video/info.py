"""Reads a YouTube video's metadata with yt-dlp, downloading nothing.

Reads a JSON job from stdin: {"id": YouTube video id}.
Prints one JSON line: {"title", "channel", "duration", "categories", "chapters": [{"start", "title"}], "language"}.
"""

import json
import sys

import yt_dlp
from pydantic import BaseModel

SOCKET_TIMEOUT = 30  # seconds a YouTube connection may stall


class Job(BaseModel):
    id: str


def main() -> None:
    job = Job.model_validate_json(sys.stdin.read())
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "socket_timeout": SOCKET_TIMEOUT}) as ydl:
        meta = ydl.extract_info(f"https://www.youtube.com/watch?v={job.id}", download=False) or {}
    chapters = [{"start": c["start_time"], "title": c["title"]} for c in meta.get("chapters") or []]
    info = {
        "title": meta.get("title") or job.id,
        "channel": meta.get("channel"),
        "duration": meta.get("duration"),
        "categories": meta.get("categories") or [],
        "chapters": chapters,
        "language": meta.get("language"),
    }
    print(json.dumps({k: v for k, v in info.items() if v is not None}), flush=True)


if __name__ == "__main__":
    main()
