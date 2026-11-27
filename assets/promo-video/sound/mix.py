"""Puts the soundtrack on the silent render: the music plus a sound at each cue of cues.json.

Usage (from assets/promo-video): python3 sound/mix.py dzhura-promo-silent.mp4 dzhura-promo.mp4
"""

import argparse
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
SOUNDS = {"swish": 2.0, "click": 0.35, "pop": 0.3}  # file name → volume
LENGTH = 92  # seconds, the composition's data-duration
TEMPO = 0.9464  # the music is 87 s long; slowed down to end with the video


def filter_graph(cues: list[tuple[str, float]]) -> str:
    """Input 0 is the video, 1 the music, then one input per sound in SOUNDS order."""
    parts = [f"[1:a]atempo={TEMPO},volume=0.5,afade=t=in:d=0.6,afade=t=out:st={LENGTH - 2.8}:d=2.8,atrim=0:{LENGTH}[m]"]
    labels: list[str] = []
    for i, (name, volume) in enumerate(SOUNDS.items(), start=2):
        times = [t for kind, t in cues if kind == name]
        parts.append(f"[{i}:a]volume={volume},asplit={len(times)}" + "".join(f"[{name}{j}]" for j in range(len(times))))
        for j, t in enumerate(times):
            ms = int(t * 1000)
            parts.append(f"[{name}{j}]adelay={ms}|{ms}[{name}d{j}]")
            labels.append(f"[{name}d{j}]")
    parts.append(f"[m]{''.join(labels)}amix=inputs={len(labels) + 1}:normalize=0,alimiter=limit=0.9[a]")
    return ";".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("out")
    args = parser.parse_args()
    cues = json.loads((HERE / "cues.json").read_text())
    inputs = ["-i", args.video, "-i", str(HERE / "music.mp3")]
    for name in SOUNDS:
        inputs += ["-i", str(HERE / f"{name}.mp3")]
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", filter_graph(cues)]
        + ["-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", str(LENGTH), args.out],
        check=True,
        timeout=300,
    )


if __name__ == "__main__":
    main()
