import numpy as np
import pytest

from tts import audio
from tts.kokoro import english_text

RATE = 100


def second() -> np.ndarray:
    return np.full(RATE, 0.05, dtype=np.float32)


def speak(line: str) -> list[np.ndarray]:
    """One second of sound per sentence."""
    return [second() for sentence in line.split(". ") if sentence.strip()]


def durations(part: list[np.ndarray]) -> list[float]:
    return [len(a) / RATE for a in part]


def test_pauses() -> None:
    parts = audio.timeline("One. Two.\n\nChapter Two\nThree.", speak, RATE)
    assert [durations(p) for p in parts] == [
        [1, audio.PAUSE_SENTENCES, 1, audio.PAUSE_PARAGRAPH, 1, audio.PAUSE_HEADING, 1, audio.PAUSE_PARAGRAPH]
    ], "a sentence pause inside a line, a longer one after it, the longest after a heading; empty lines add nothing"


def test_new_part_after_max_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(audio, "MAX_PART_SECONDS", 3)
    parts = audio.timeline("One.\nTwo.\nThree.", speak, RATE)
    assert [durations(p) for p in parts] == [
        [1, audio.PAUSE_PARAGRAPH, 1, audio.PAUSE_PARAGRAPH],
        [1, audio.PAUSE_PARAGRAPH],
    ]


def test_loudness_evened_out() -> None:
    quiet = audio.even_out(np.full(RATE, 0.01, dtype=np.float32))
    loud = audio.even_out(np.full(RATE, 0.9, dtype=np.float32))
    assert quiet.max() == pytest.approx(0.02), "at most twice louder"
    assert loud.max() == pytest.approx(0.45), "at most twice quieter"


def test_assemble_makes_mp3() -> None:
    parts = audio.assemble("One. Two.", speak, 24000)
    assert len(parts) == 1
    assert parts[0][:3] == b"ID3" or parts[0][0] == 0xFF, "mp3 frame or tag"


def test_english_text() -> None:
    assert english_text("CHAPTER XII. The Yacht") == "CHAPTER 12. The Yacht"
    assert english_text("Part IV") == "Part 4"
    assert english_text("I said, Chapter I was fine. Louis XIV") == "I said, Chapter 1 was fine. Louis XIV"
