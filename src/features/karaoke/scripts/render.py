"""Burns the karaoke subtitles into the clip with ffmpeg (libass), fitting Telegram's 50 MB limit."""

import os
import subprocess

BACKGROUND = "eq=brightness=-0.12:saturation=0.85"
LIMIT = 49 * 1024 * 1024
AUDIO_BITRATE = 160_000


def render(work_dir: str, ass_path: str, audio: str, out: str, duration: float, pause: float = 0.0) -> tuple[str, str]:
    """(Telegram video, full-quality video): the same file unless the full one is over Telegram's limit,
    then it is kept as «<name> (HQ).mp4» for YouTube. `audio` is "clip" for the clip's own sound, or a wav path (the music stem).
    `pause`: seconds of silence on the first frame before the clip (a count-in); `duration` includes it."""
    clip = os.path.abspath(os.path.join(work_dir, "clip.mp4"))
    inputs = ["-i", clip] if audio == "clip" else ["-i", clip, "-i", os.path.abspath(audio)]
    sound = "0:a" if audio == "clip" else "1:a"
    out = os.path.abspath(out)
    pad = f"tpad=start_duration={pause}:start_mode=clone," if pause else ""
    delay = ["-af", f"adelay={round(pause * 1000)}:all=1"] if pause else []

    def encode(video_args: list[str], out: str) -> None:
        tmp = out + ".part.mp4"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", *inputs, "-map", "0:v", "-map", sound, *delay, "-vf", f"{pad}{BACKGROUND},ass={os.path.basename(ass_path)}",
             "-c:v", "libx264", "-preset", "medium", *video_args, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", tmp],
            check=True,
            cwd=os.path.dirname(os.path.abspath(ass_path)),  # a bare file name: no filtergraph escaping of «'» in song names
        )
        os.replace(tmp, out)

    full = out
    encode(["-crf", "22"], full)
    if os.path.getsize(full) > LIMIT:
        full = out[: -len(".mp4")] + " (HQ).mp4"
        os.replace(out, full)
        kbps = int((LIMIT * 8 / duration - AUDIO_BITRATE) * 0.95 / 1000)
        encode(["-b:v", f"{kbps}k", "-maxrate", f"{kbps}k", "-bufsize", f"{kbps * 2}k"], out)
    return out, full
