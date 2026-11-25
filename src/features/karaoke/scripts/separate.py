"""Splits the clip's audio into vocals and music with audio-separator (MelBand RoFormer)."""

import logging
import os
import subprocess

MODEL = "vocals_mel_band_roformer.ckpt"


def separate(work_dir: str) -> tuple[str, str]:
    """Returns (vocals.wav, music.wav) under <work_dir>/stems; models live next to the song folders, in models/."""
    stems = os.path.join(work_dir, "stems")
    vocals, music = os.path.join(stems, "vocals.wav"), os.path.join(stems, "music.wav")
    if os.path.exists(vocals) and os.path.exists(music):
        return vocals, music
    os.makedirs(stems, exist_ok=True)
    song = os.path.join(stems, "song.wav")
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            os.path.join(work_dir, "clip.mp4"),
            "-vn",
            "-ac",
            "2",
            "-ar",
            "44100",
            song,
        ],
        check=True,
    )

    from audio_separator.separator import Separator

    separator = Separator(
        log_level=logging.WARNING,
        model_file_dir=os.path.join(os.path.dirname(os.path.abspath(work_dir)), "models"),
        output_dir=stems,
        output_format="WAV",
    )
    separator.load_model(model_filename=MODEL)
    outputs = separator.separate(song, {"Vocals": "vocals-tmp", "Other": "music-tmp"})
    os.replace(os.path.join(stems, "music-tmp.wav"), music)
    os.replace(os.path.join(stems, "vocals-tmp.wav"), vocals)  # last: vocals.wav existing means both are done
    os.remove(song)
    assert len(outputs) == 2, outputs
    return vocals, music
