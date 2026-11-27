"""A chapter's text into mp3 parts, whichever model speaks it: pauses, even loudness, a new file every 90 min."""

import re
import subprocess
from collections.abc import Callable

import numpy as np

# Speeding up one chapter part (up to 90 min of mp3) takes seconds; 10 minutes only catches a hung ffmpeg.
TEMPO_TIMEOUT = 10 * 60
MAX_PART_SECONDS = 90 * 60  # 90 min of 64 kbps mp3 ≈ 43 MB, under Telegram's 50 MB
PAUSE_SENTENCES = 0.35
PAUSE_PARAGRAPH = 0.7
PAUSE_HEADING = 1.2  # after a line with no final punctuation: «Розділ I. Риба-молот»
TARGET_RMS = 0.053  # typical loudness of a HolosTTS sentence; quieter or louder ones are evened out

# Turns one line of text into its sentences' audio, in order.
Speak = Callable[[str], list[np.ndarray]]


def even_out(audio: np.ndarray) -> np.ndarray:
    rms = float(np.sqrt(np.mean(audio**2))) or 1.0
    audio = audio * min(max(TARGET_RMS / rms, 0.5), 2.0)
    peak = float(np.abs(audio).max())
    return audio * (0.95 / peak) if peak > 0.95 else audio


def timeline(text: str, speak: Speak, rate: int) -> list[list[np.ndarray]]:
    """The chapter's sound and pauses, cut into parts of about MAX_PART_SECONDS."""
    parts: list[list[np.ndarray]] = []
    samples: list[np.ndarray] = []
    seconds = 0.0
    for line in text.split("\n"):
        heading = not re.search(r"[.!?…:;»\"”)]$", line.strip())
        sentences = speak(line) if line.strip() else []
        for k, sound in enumerate(sentences):
            last = k == len(sentences) - 1
            pause = PAUSE_HEADING if last and heading else PAUSE_PARAGRAPH if last else PAUSE_SENTENCES
            silence = np.zeros(int(rate * pause), dtype=np.float32)
            samples += [even_out(sound), silence]
            seconds += (len(sound) + len(silence)) / rate
            if seconds >= MAX_PART_SECONDS:
                parts.append(samples)
                samples, seconds = [], 0.0
    if samples:
        parts.append(samples)
    return parts


def encode(samples: list[np.ndarray], rate: int) -> bytes:
    import lameenc

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(64)
    encoder.set_in_sample_rate(rate)
    encoder.set_channels(1)
    pcm = (np.clip(np.concatenate(samples), -1, 1) * 32767).astype(np.int16)
    return bytes(encoder.encode(pcm.tobytes()) + encoder.flush())


def change_tempo(mp3: bytes, tempo: float) -> bytes:
    """The mp3 played `tempo` times faster, its pitch kept (ffmpeg atempo); tempo 1 returns it as is."""
    if tempo == 1:
        return mp3
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-filter:a", f"atempo={tempo}"]
        + ["-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1", "-f", "mp3", "pipe:1"],
        input=mp3,
        capture_output=True,
        check=True,
        timeout=TEMPO_TIMEOUT,
    ).stdout


def assemble(text: str, speak: Speak, rate: int) -> list[bytes]:
    """The chapter as mp3 files, in order."""
    return [encode(part, rate) for part in timeline(text, speak, rate)]
