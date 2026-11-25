"""Fish Audio cloud TTS provider (needs FISH_API_KEY; FISH_MODEL defaults to s2.1-pro-free)."""

import json
import os
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from sentences import pack, split_sentences

URL = "https://api.fish.audio/v1/tts"
MAX_CHUNK_CHARS = 2000
MAX_PART_BYTES = 49 * 1024 * 1024  # Telegram sendAudio limit is 50 MB
PARALLEL_CHUNKS = 3
RETRIES = 3
ACCOUNT_ERRORS = (401, 402, 403)


class FatalError(Exception):
    """The account cannot voice anything (bad key, no balance): stop the whole book."""


def to_fish_text(text: str) -> str:
    """Fish reads Ukrainian with Russian letter sounds, so: a stressed vowel (U+0301 after it)
    becomes uppercase, which the model treats as stress, and и/е become ы/э, which it reads
    the way Ukrainian и/е sound."""
    text = re.sub("([аеєиіїоуюяАЕЄИІЇОУЮЯ])́", lambda m: m[1].upper(), unicodedata.normalize("NFD", text))
    text = unicodedata.normalize("NFC", text).replace("́", "")
    return text.translate(str.maketrans("иИеЕ", "ыЫэЭ"))


def synthesize(text: str, voice: str) -> bytes:
    """mp3 bytes; network errors, 429 and 5xx are retried, account errors raise FatalError."""
    import requests

    headers = {
        "Authorization": f"Bearer {os.environ['FISH_API_KEY']}",
        "model": os.environ.get("FISH_MODEL") or "s2.1-pro-free",
    }
    body = {"text": text, "reference_id": voice, "format": "mp3", "mp3_bitrate": 64, "language": "uk"}
    last: Exception = RuntimeError("no attempts")
    for attempt in range(RETRIES + 1):
        if attempt:
            time.sleep(2 * attempt)
        try:
            res = requests.post(URL, headers=headers, json=body, timeout=300)
        except requests.RequestException as error:
            last = error
            continue
        if res.ok:
            return res.content
        message = f"Fish Audio {res.status_code}: {res.text[:200]}"
        if res.status_code in ACCOUNT_ERRORS:
            raise FatalError(message)
        if res.status_code != 429 and res.status_code < 500:
            raise RuntimeError(message)
        last = RuntimeError(message)
    raise last


def make():
    def voice_chapter(text: str, voice: str) -> list[bytes]:
        chunks = pack(split_sentences(to_fish_text(text)), MAX_CHUNK_CHARS)
        with ThreadPoolExecutor(PARALLEL_CHUNKS) as pool:
            audio = list(pool.map(lambda chunk: synthesize(chunk, voice), chunks))
        parts: list[bytes] = []
        for piece in audio:
            if parts and len(parts[-1]) + len(piece) <= MAX_PART_BYTES:
                parts[-1] += piece
            else:
                parts.append(piece)
        return parts

    return voice_chapter
