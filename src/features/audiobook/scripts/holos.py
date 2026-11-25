"""HolosTTS local provider (Apple Silicon, MLX). Native Ukrainian; takes IPA phonemes."""

import re

from sentences import pack, split_sentences

MAX_PART_SECONDS = 90 * 60  # 90 min of 64 kbps mp3 ≈ 43 MB, under Telegram's 50 MB
CHUNK_CHARS = 0  # >0 packs sentences into one model call up to this size: smoother intonation, but ~3× slower at 250
PAUSE_SENTENCES = 0.35
PAUSE_PARAGRAPH = 0.7
PAUSE_HEADING = 1.2  # after a line with no final punctuation: «Розділ I. Риба-молот»
TARGET_RMS = 0.053  # typical loudness of a HolosTTS sentence; quieter or louder chunks are evened out


def make():
    import lameenc
    import numpy as np
    from holos_mlx import HolosTTS
    from ipa_uk import ipa

    model = HolosTTS()
    rate = model.sample_rate

    def silence(seconds: float):
        return np.zeros(int(rate * seconds), dtype=np.float32)

    def even_out(audio):
        rms = float(np.sqrt(np.mean(audio**2))) or 1.0
        audio = audio * min(max(TARGET_RMS / rms, 0.5), 2.0)
        peak = float(np.abs(audio).max())
        return audio * (0.95 / peak) if peak > 0.95 else audio

    def encode(samples: list) -> bytes:
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(64)
        encoder.set_in_sample_rate(rate)
        encoder.set_channels(1)
        pcm = (np.clip(np.concatenate(samples), -1, 1) * 32767).astype(np.int16)
        return bytes(encoder.encode(pcm.tobytes()) + encoder.flush())

    def voice_chapter(text: str, voice: str) -> list[bytes]:
        parts, samples, seconds = [], [], 0.0
        for line in text.split("\n"):
            heading = not re.search(r"[.!?…:;»\"”)]$", line.strip())
            chunks = pack(split_sentences(line), CHUNK_CHARS)
            for k, chunk in enumerate(chunks):
                phonemes = ipa(chunk)
                if not phonemes.strip():
                    continue
                audio = even_out(np.asarray(model.generate(phonemes, voice=voice, speed=1.0), dtype=np.float32))
                last = k == len(chunks) - 1
                pause = silence(PAUSE_HEADING if last and heading else PAUSE_PARAGRAPH if last else PAUSE_SENTENCES)
                samples += [audio, pause]
                seconds += (len(audio) + len(pause)) / rate
                if seconds >= MAX_PART_SECONDS:
                    parts.append(encode(samples))
                    samples, seconds = [], 0.0
        if samples:
            parts.append(encode(samples))
        return parts

    return voice_chapter
