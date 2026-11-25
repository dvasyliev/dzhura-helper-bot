"""HolosTTS local provider (Apple Silicon, MLX). Native Ukrainian; takes IPA phonemes."""

from sentences import split_sentences

MAX_PART_SECONDS = 90 * 60  # 90 min of 64 kbps mp3 ≈ 43 MB, under Telegram's 50 MB
PAUSE_SECONDS = 0.3


def make(stressify):
    import lameenc
    import numpy as np
    from holos_mlx import HolosTTS
    from ipa_uk import ipa

    model = HolosTTS()
    rate = model.sample_rate
    pause = np.zeros(int(rate * PAUSE_SECONDS), dtype=np.float32)

    def save(samples: list, path: str) -> None:
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(64)
        encoder.set_in_sample_rate(rate)
        encoder.set_channels(1)
        pcm = (np.clip(np.concatenate(samples), -1, 1) * 32767).astype(np.int16)
        with open(path, "wb") as f:
            f.write(encoder.encode(pcm.tobytes()) + encoder.flush())

    def voice_chapter(text: str, voice: str, prefix: str) -> list[str]:
        files, samples, seconds = [], [], 0.0
        for sentence in split_sentences(text):
            phonemes = ipa(stressify(sentence))
            if not phonemes.strip():
                continue
            audio = np.asarray(model.generate(phonemes, voice=voice, speed=1.0), dtype=np.float32)
            samples += [audio, pause]
            seconds += (len(audio) + len(pause)) / rate
            if seconds >= MAX_PART_SECONDS:
                files.append(f"{prefix}-{len(files)}.mp3")
                save(samples, files[-1])
                samples, seconds = [], 0.0
        if samples:
            files.append(f"{prefix}-{len(files)}.mp3")
            save(samples, files[-1])
        return files

    return voice_chapter
