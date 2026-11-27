"""Listens to the vocal stem with Whisper: the song's language and what is sung."""

import json
import os
from pathlib import Path
from typing import cast

from pydantic import BaseModel

WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"


class Heard(BaseModel):
    """What listen.json holds."""

    language: str
    text: str
    lines: list[str]


def listen(vocals_wav: str, work_dir: str) -> dict:
    """{"language": "uk", "text": "...", "lines": [...]}, cached in <work_dir>/listen.json."""
    cache = os.path.join(work_dir, "listen.json")
    if os.path.exists(cache):
        return Heard.model_validate_json(Path(cache).read_text(encoding="utf-8")).model_dump()
    import mlx_whisper

    # Not conditioning on earlier text keeps Whisper from looping a line through instrumental parts.
    result = mlx_whisper.transcribe(
        vocals_wav, path_or_hf_repo=WHISPER_MODEL, condition_on_previous_text=False, verbose=None
    )
    segments = cast(list[dict], result["segments"])
    lines = [s["text"].strip() for s in segments if s["text"].strip()]
    heard = {"language": result["language"], "text": " ".join(lines), "lines": lines}
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(heard, f, ensure_ascii=False, indent=1)
    return heard
