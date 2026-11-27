"""Checks a finished karaoke against the vocals for the mistakes seen so far; prints each problem with its time.

Run: uv run python -m dzhura_helper_bot.karaoke.verify "<song folder>" "<video name>.mp4"
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

from dzhura_helper_bot.karaoke.align import BREAK, CRAMMED, MAX_DRIFT, SAMPLE_RATE
from dzhura_helper_bot.karaoke.subtitles import DIGITS, MARKER_GAP

# Decoding or probing one rendered clip takes seconds; 10 minutes only catches a hung ffmpeg.
PROBE_TIMEOUT = 10 * 60
HOP = SAMPLE_RATE // 20  # 50 ms frames
SILENT_TAIL = 0.5  # a word held this long over silence is stretched past the singing
MISPLACED = 0.4  # no voice this close after a word's start: the word is not where it is sung
FAST = 6.0  # words per second no one sings
SYNC = 0.15  # the video's sound may drift this far from the clip's music


def _loudness(samples: np.ndarray) -> tuple[np.ndarray, float]:
    frames = samples[: len(samples) // HOP * HOP].reshape(-1, HOP)
    rms = np.sqrt((frames**2).mean(axis=1))
    return rms, 0.05 * float(np.percentile(rms, 95))


def _at(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:05.2f}"


def check_words(lines: list[dict], samples: np.ndarray) -> list[str]:
    """Words held over silence, and words placed where no one sings."""
    rms, loud = _loudness(samples)
    voiced = rms > loud
    problems = []
    for line in lines:
        for w in line["words"]:
            a, b = int(w["start"] * 20), int(w["end"] * 20)
            silent = int((~voiced[a:b]).sum()) / 20
            if silent >= SILENT_TAIL and silent > (b - a) / 40:
                problems.append(f"{_at(w['start'])} «{w['text']}» held {silent:.1f} s over silence")
            if not voiced[max(0, a - 2) : a + int(MISPLACED * 20)].any():
                problems.append(f"{_at(w['start'])} «{w['text']}» starts where no one sings")
    return problems


def check_lines(lines: list[dict], lrc: list[dict]) -> list[str]:
    """Overlapping lines, lines squeezed into too little time, lines far from their LRC timing."""
    problems = []
    for a, b in zip(lines, lines[1:], strict=False):
        if b["words"][0]["start"] < a["words"][-1]["end"] - 0.05:
            problems.append(f"{_at(b['words'][0]['start'])} «{b['text']}» starts before «{a['text']}» ends")
    for line in lines:
        span = line["words"][-1]["end"] - line["words"][0]["start"]
        if len(line["words"]) > 2 and len(line["words"]) / max(span, 0.01) > FAST:
            problems.append(f"{_at(line['words'][0]['start'])} «{line['text']}» squeezed into {span:.1f} s")
    if lrc and all(l["lrc_start"] is not None for l in lrc):
        drifts = [a["words"][0]["start"] - l["lrc_start"] for a, l in zip(lines, lrc, strict=True)]
        offset = sorted(drifts)[len(drifts) // 2]
        for i, (line, d) in enumerate(zip(lines, drifts, strict=True)):
            if abs(d - offset) > MAX_DRIFT:
                problems.append(
                    f"{_at(line['words'][0]['start'])} «{line['text']}» {d - offset:+.1f} s from its LRC time"
                )
            nxt = lrc[i + 1]["lrc_start"] if i + 1 < len(lrc) else None
            span = line["words"][-1]["end"] - line["words"][0]["start"]
            before_break = i + 1 < len(lines) and lines[i + 1]["words"][0]["start"] - line["words"][-1]["end"] > BREAK
            if (
                not before_break
                and nxt is not None
                and lrc[i]["lrc_start"] is not None
                and span < CRAMMED * (nxt - lrc[i]["lrc_start"]) / 2
            ):
                problems.append(f"{_at(line['words'][0]['start'])} «{line['text']}» much shorter than in the LRC")
    return problems


def _events(ass: str) -> list[tuple[float, float, str, str]]:
    def secs(t: str) -> float:
        h, m, s = t.split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)

    out = []
    for row in ass.split("[Events]")[1].splitlines():
        if row.startswith("Dialogue:"):
            parts = row.split(",", 9)
            out.append((secs(parts[1]), secs(parts[2]), parts[3], parts[9]))
    return out


def check_ass(ass: str, lines: list[dict]) -> list[str]:
    """Every countdown bar has all its digits; every line after a pause has its marker."""
    events = _events(ass)
    problems = []
    for start, end, style, _ in events:
        if style == "Countdown" and "\\clip" in _:
            digits = [e for e in events if e[2] == "Digit" and start - 0.01 <= e[0] < end + 0.5]
            if len(digits) < DIGITS:
                problems.append(f"{_at(start)} countdown shows {len(digits)} digits, not {DIGITS}")
    markers = [e[1] for e in events if e[2] == "Marker"]
    for prev, line in zip([None, *lines], lines, strict=False):
        start = line["words"][0]["start"]
        gap = start - (prev["words"][-1]["end"] if prev else 0.0)
        if gap >= MARKER_GAP and not any(abs(m - start - 0.05) < 0.1 for m in markers):
            problems.append(f"{_at(start)} «{line['text']}» after a {gap:.1f} s pause has no marker")
    return problems


def _decode(path: str, sr: int = 11025, start: float = 0.0) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
        timeout=PROBE_TIMEOUT,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def _length(video: str, kind: str) -> float:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            kind,
            "-show_entries",
            "stream=duration",
            "-of",
            "csv=p=0",
            video,
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=PROBE_TIMEOUT,
    ).stdout
    return float(out)


def check_video(video: str, music: str, pause: float, clicks: list[float]) -> list[str]:
    """Picture and sound of equal length, clicks inside the pause, the sound in step with the clip's music."""
    import librosa

    problems = []
    v, a = _length(video, "v"), _length(video, "a")
    if abs(v - a) > 0.2:
        problems.append(f"picture {v:.1f} s, sound {a:.1f} s")
    if clicks and clicks[-1] + 0.05 > pause:
        problems.append(f"{_at(clicks[-1])} a count-in click falls on the song (it starts at {_at(pause)})")
    sr, hop = 11025, 256
    got = librosa.onset.onset_strength(y=_decode(video, sr, pause), sr=sr, hop_length=hop)
    want = librosa.onset.onset_strength(y=_decode(music, sr), sr=sr, hop_length=hop)
    fps, reach = sr / hop, int(2 * sr / hop)
    for t in range(10, int(len(want) / fps) - 30, 30):
        s, e = int(t * fps), int((t + 20) * fps)
        x = want[s:e] - want[s:e].mean()
        scores = {
            d: float(np.dot(x, got[s + d : e + d] - got[s + d : e + d].mean()))
            for d in range(-reach, reach + 1)
            if 0 <= s + d and e + d <= len(got)
        }
        if scores:
            lag = max(scores, key=lambda d: scores[d]) / fps
            if abs(lag) > SYNC:
                problems.append(f"{_at(t + pause)} sound {lag:+.2f} s off the clip's music")
    return problems


def verify(song: str, video: str) -> list[str]:
    from ctc_forced_aligner import load_audio

    import torch

    lines = json.loads(Path(song, "aligned.json").read_text(encoding="utf-8"))
    lrc = json.loads(Path(song, "lyrics.json").read_text(encoding="utf-8"))
    countin_file = os.path.join(song, "countin.json")
    count = (
        json.loads(Path(countin_file).read_text(encoding="utf-8"))
        if os.path.exists(countin_file)
        else {"pause": 0.0, "beats": []}
    )
    samples = load_audio(os.path.join(song, "stems", "vocals.wav"), torch.float32, "cpu").numpy()
    ass = Path(song, "karaoke.ass").read_text(encoding="utf-8")
    shown = [
        {
            **l,
            "words": [
                {**w, "start": w["start"] + count["pause"], "end": w["end"] + count["pause"]} for w in l["words"]
            ],
        }
        for l in lines
    ]
    return [
        *check_words(lines, samples),
        *check_lines(lines, lrc),
        *check_ass(ass, shown),
        *check_video(
            os.path.join(song, video), os.path.join(song, "stems", "music.wav"), count["pause"], count["beats"] or []
        ),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("song", help="the song's folder")
    parser.add_argument("video", help="the karaoke video's file name in that folder")
    args = parser.parse_args()
    problems = verify(args.song, args.video)
    print("\n".join(problems) or "OK", file=sys.stderr)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
