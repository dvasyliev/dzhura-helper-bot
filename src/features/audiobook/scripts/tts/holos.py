"""HolosTTS local provider (Apple Silicon, MLX). Native Ukrainian; takes IPA phonemes."""

import numpy as np

from tts.audio import assemble
from sentences import pack, split_sentences

CHUNK_CHARS = 0  # >0 packs sentences into one model call up to this size: smoother intonation, but ~3× slower at 250


def make():
    from holos_mlx import HolosTTS
    from ipa_uk import ipa

    model = HolosTTS()

    def voice_chapter(text: str, voice: str) -> list[bytes]:
        def speak(line: str) -> list[np.ndarray]:
            phonemes = [ipa(chunk) for chunk in pack(split_sentences(line), CHUNK_CHARS)]
            return [
                np.asarray(model.generate(p, voice=voice, speed=1.0), dtype=np.float32) for p in phonemes if p.strip()
            ]

        return assemble(text, speak, model.sample_rate)

    return voice_chapter
