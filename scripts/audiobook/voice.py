"""Voices a book with the chosen provider: holos (local HolosTTS) or fish (Fish Audio).

Reads a JSON job from stdin: {"provider": "holos", "voice": "Speaker_0", "out_dir": "...", "chapters": ["text", ...]}.
Each chapter: numbers → words, stress marks, then the provider writes <out_dir>/<NNN>-<part>.mp3
(parts fit Telegram's 50 MB limit). Prints one JSON line per chapter:
{"chapter": i, "files": [...]} or {"chapter": i, "error": "..."}; with "fatal": true the book stops.
Usage: echo '{"provider": "holos", "voice": "Speaker_0", "out_dir": "data/audio/x", "chapters": ["Привіт."]}' \
  | uv run python scripts/audiobook/voice.py
"""

import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

import fish  # noqa: E402
import holos  # noqa: E402
from numbers_uk import numbers_to_words  # noqa: E402

PROVIDERS = {"holos": holos.make, "fish": fish.make}


def main() -> None:
    from ukrainian_word_stress import Stressifier

    job = json.load(sys.stdin)
    os.makedirs(job["out_dir"], exist_ok=True)
    voice_chapter = PROVIDERS[job["provider"]](Stressifier())

    for i, text in enumerate(job["chapters"]):
        try:
            files = voice_chapter(numbers_to_words(text), job["voice"], f"{job['out_dir']}/{i + 1:03d}")
            print(json.dumps({"chapter": i, "files": files}), flush=True)
        except fish.FatalError as error:
            print(json.dumps({"chapter": i, "error": str(error), "fatal": True}, ensure_ascii=False), flush=True)
            return
        except Exception as error:  # one bad chapter must not stop the book
            print(json.dumps({"chapter": i, "error": str(error)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
