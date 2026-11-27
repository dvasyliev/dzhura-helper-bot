"""HolosTTS local provider (Apple Silicon, MLX). Native Ukrainian; takes IPA phonemes."""

import numpy as np

from dzhura_helper_bot.audiobook.tts.audio import assemble
from dzhura_helper_bot.audiobook.sentences import pack, split_sentences

# MLX keeps freed GPU buffers for reuse, one set per sentence length; unbounded, a book's voicing grew to 24 GB.
CACHE_BYTES = 512 * 2**20
CHUNK_CHARS = 0  # >0 packs sentences into one model call up to this size: smoother intonation, but ~3× slower at 250


def make():
    import mlx.core as mx
    from holos_mlx import HolosTTS
    from ipa_uk import ipa

    mx.set_cache_limit(CACHE_BYTES)
    model = HolosTTS()

    def voice_chapter(text: str, voice: str) -> list[bytes]:
        def speak(line: str) -> list[np.ndarray]:
            phonemes = [ipa(chunk) for chunk in pack(split_sentences(line), CHUNK_CHARS)]
            return [
                np.asarray(model.generate(p, voice=voice, speed=1.0), dtype=np.float32) for p in phonemes if p.strip()
            ]

        try:
            return assemble(text, speak, model.sample_rate)
        finally:
            mx.clear_cache()  # each chapter starts with the memory of the bare model

    return voice_chapter
