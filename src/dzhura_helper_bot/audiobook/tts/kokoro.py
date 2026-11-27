"""Kokoro local provider for English (Apple Silicon, MLX through mlx-audio). misaki turns the text into
phonemes itself (numbers and abbreviations included), with espeak for words it does not know."""

import re
from typing import Any, cast

import numpy as np

from dzhura_helper_bot.audiobook.tts.audio import assemble
from dzhura_helper_bot.audiobook.sentences import split_sentences

MODEL = "mlx-community/Kokoro-82M-bf16"
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def roman_to_int(roman: str) -> int:
    values = [ROMAN[c] for c in roman]
    return sum(-v if v < after else v for v, after in zip(values, [*values[1:], 0]))


def english_text(text: str) -> str:
    """«CHAPTER XII» → «CHAPTER 12»: misaki would spell the numeral letter by letter."""
    return re.sub(
        r"\b(chapter|part|book)\s+([IVXLCDM]+)\b",
        lambda m: f"{m[1]} {roman_to_int(m[2])}",
        text,
        flags=re.IGNORECASE,
    )


def make():
    from mlx_audio.tts.utils import load_model

    # Its hints say a Path and a plain nn.Module; the docs pass a Hugging Face id and use Kokoro's own methods.
    model: Any = cast(Any, load_model)(MODEL)

    def voice_chapter(text: str, voice: str) -> list[bytes]:
        def speak(line: str) -> list[np.ndarray]:
            # The voice id's first letter is Kokoro's language: a (American), b (British).
            return [
                np.concatenate(
                    [
                        np.asarray(r.audio, dtype=np.float32)
                        for r in model.generate(text=sentence, voice=voice, speed=1.0, lang_code=voice[0])
                    ]
                )
                for sentence in split_sentences(english_text(line))
            ]

        return assemble(text, speak, model.sample_rate)

    return voice_chapter
