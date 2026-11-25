"""A count-in for songs that start singing at once: a silent pause of a few beats before the clip, on the song's beat."""

import numpy as np

BEATS = 4
SOON = 4.0  # singing earlier than this has no room for a 3-2-1 countdown, so it gets a count-in


def count_in(music_wav: str, first_word: float) -> tuple[float, list[float]]:
    """(pause length, the count-in beats in the paused video): the last beats of the song's grid before the first word."""
    import librosa

    y, sr = librosa.load(music_wav, sr=22050, mono=True, duration=60)
    _, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    beat = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
    while beat < 0.4:  # 150+ BPM counts in half time
        beat *= 2
    while beat > 1.0:
        beat /= 2
    phase = float(beats[0]) % beat if len(beats) else 0.0
    pause = BEATS * beat
    last = int((first_word + pause - 0.1 - phase) // beat)
    return pause, [max(0.0, phase + (last - BEATS + 1 + k) * beat) for k in range(BEATS)]


def delay(lines: list[dict], by: float) -> list[dict]:
    return [
        {**ln, "words": [{**w, "start": w["start"] + by, "end": w["end"] + by} for w in ln["words"]]} for ln in lines
    ]
