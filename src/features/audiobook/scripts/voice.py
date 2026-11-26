"""Voices chapters of a book with the chosen voice's provider: holos (HolosTTS, Ukrainian) or kokoro (Kokoro, English).

Reads a JSON job from stdin:
  {"provider": "holos", "language": "uk", "voice": "Speaker_0", "text_dir": "...", "audio_dir": "...", "dictionary": "...", "report": "... or null",
   "chapters": [{"index": 0, "name": "001 Розділ I. Риба-молот", "text": "..."}, ...]}
Each chapter's text is saved to <text_dir>/<name>.txt unless that file is already there: a Ukrainian one
prepared (uk/prepare.py: stresses, numbers and abbreviations as words), an English one as written,
then voiced into <audio_dir>/<name>.mp3, or «<name> (1).mp3», «(2)»… when it is too long for one
Telegram file. Texts are prepared in a second process while the voice is generated.
Prints JSON lines: {"chapter": index, "files": [...]} per chapter in order; {"report": path, "words": n}
once all texts are prepared; {"chapter": index, "error": "..."} and stops if a chapter fails twice.
Usage: echo '{"provider": "holos", "language": "uk", "voice": "Speaker_0", "text_dir": "/tmp/t", "audio_dir": "/tmp/a", "dictionary": "/tmp/d.txt", "report": null,
  "chapters": [{"index": 0, "name": "001 Тест", "text": "Привіт."}]}' | uv run python src/features/audiobook/scripts/voice.py
"""

import json
import os
import sys
import warnings
from concurrent.futures import ProcessPoolExecutor

warnings.filterwarnings("ignore")

from tts import holos, kokoro  # noqa: E402
from uk.prepare import apply_dictionary, load_stress, prepare_file, write_report  # noqa: E402

PREPARE_THREADS = "2"
PROVIDERS = {"holos": holos.make, "kokoro": kokoro.make}


def keep_text(text: str, path: str, _dictionary: str) -> str:
    """An English chapter is voiced as written; saved so it can be edited before /regen."""
    if not os.path.exists(path):
        with open(f"{path}.part", "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(f"{path}.part", path)
    return path


# How a chapter's text is saved, by the book's language.
PREPARE = {"uk": prepare_file, "en": keep_text}


def save(parts: list[bytes], audio_dir: str, name: str) -> list[str]:
    """Writes under temporary names, then renames the first file last: if «<name>.mp3» or
    «<name> (1).mp3» exists, the whole chapter is complete."""
    files = (
        [f"{audio_dir}/{name}.mp3"]
        if len(parts) == 1
        else [f"{audio_dir}/{name} ({k + 1}).mp3" for k in range(len(parts))]
    )
    for file, data in zip(files, parts):
        with open(f"{file}.part", "wb") as f:
            f.write(data)
    for file in reversed(files):
        os.replace(f"{file}.part", file)
    return files


def emit(**fields) -> None:
    print(json.dumps(fields, ensure_ascii=False), flush=True)


def main() -> None:
    job = json.load(sys.stdin)
    os.makedirs(job["text_dir"], exist_ok=True)
    os.makedirs(job["audio_dir"], exist_ok=True)
    voice_chapter = PROVIDERS[job["provider"]]()
    ukrainian = job["language"] == "uk"

    # The stress model in the text process would take every core; two keep it ahead of the voice and the Mac usable.
    os.environ["OMP_NUM_THREADS"] = PREPARE_THREADS
    with ProcessPoolExecutor(1) as pool:
        texts = [
            pool.submit(PREPARE[job["language"]], c["text"], f"{job['text_dir']}/{c['name']}.txt", job["dictionary"])
            for c in job["chapters"]
        ]
        reported = False
        for chapter, text in zip(job["chapters"], texts):
            files: list[str] = []
            for attempt in (1, 2):
                try:
                    with open(text.result(), encoding="utf-8") as f:
                        prepared = f.read()
                    if ukrainian:  # the dictionary may be edited meanwhile
                        prepared = apply_dictionary(prepared, load_stress(job["dictionary"]))
                    files = save(voice_chapter(prepared, job["voice"]), job["audio_dir"], chapter["name"])
                    break
                except Exception as error:
                    if attempt == 2:
                        emit(chapter=chapter["index"], error=str(error) or type(error).__name__)
                        pool.shutdown(cancel_futures=True)  # do not wait for the texts of later chapters
                        return
            emit(chapter=chapter["index"], files=files)
            if job["report"] and not reported and all(t.done() for t in texts):
                emit(report=job["report"], words=write_report(job["text_dir"], job["report"], job["dictionary"]))
                reported = True


if __name__ == "__main__":
    main()
