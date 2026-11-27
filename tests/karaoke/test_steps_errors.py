import subprocess
from pathlib import Path

import numpy as np
import pytest

from dzhura_helper_bot.audiobook.tts import audio
from dzhura_helper_bot.karaoke import render as render_module
from dzhura_helper_bot.karaoke import separate as separate_module
from dzhura_helper_bot.karaoke.render import render
from dzhura_helper_bot.karaoke.separate import separate
from dzhura_helper_bot.karaoke.verify import check_ass, check_lines, check_words

FAILURES = [
    subprocess.CalledProcessError(1, "ffmpeg"),
    subprocess.TimeoutExpired("ffmpeg", 1),
]


def failing_run(error: Exception):
    def run(*args: object, **kwargs: object) -> object:
        raise error

    return run


@pytest.mark.parametrize("error", FAILURES, ids=["failed", "timed out"])
def test_separate_ffmpeg_error_surfaces(error: Exception, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(separate_module.subprocess, "run", failing_run(error))
    with pytest.raises(type(error)):
        separate(str(tmp_path))


@pytest.mark.parametrize("error", FAILURES, ids=["failed", "timed out"])
def test_render_ffmpeg_error_surfaces(error: Exception, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(render_module.subprocess, "run", failing_run(error))
    out = tmp_path / "out.mp4"
    out.write_bytes(b"old video")
    with pytest.raises(type(error)):
        render(str(tmp_path / "karaoke.ass"), "clip", str(out), 1)
    assert out.read_bytes() == b"old video"


@pytest.mark.parametrize("error", FAILURES, ids=["failed", "timed out"])
def test_change_tempo_ffmpeg_error_surfaces(error: Exception, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(audio.subprocess, "run", failing_run(error))
    with pytest.raises(type(error)):
        audio.change_tempo(b"mp3", 1.25)


def line(text: str, *spans: tuple[float, float], lrc: float | None = None) -> dict:
    return {
        "text": text,
        "lrc_start": lrc,
        "words": [{"text": f"w{k}", "start": a, "end": b} for k, (a, b) in enumerate(spans)],
    }


def voice(*sung: tuple[float, float], seconds: int = 20) -> np.ndarray:
    samples = np.zeros(16000 * seconds, dtype=np.float32)
    for a, b in sung:
        samples[int(a * 16000) : int(b * 16000)] = 0.3
    return samples


def test_check_words_clean() -> None:
    assert check_words([line("a", (1.0, 2.0))], voice((1.0, 3.0))) == []


def test_check_words_held_over_silence() -> None:
    problems = check_words([line("a", (1.0, 5.0))], voice((1.0, 2.0)))
    assert len(problems) == 1 and "held 3.0 s over silence" in problems[0]


def test_check_words_starts_where_no_one_sings() -> None:
    problems = check_words([line("a", (6.0, 6.2))], voice((1.0, 2.0)))
    assert len(problems) == 1 and "starts where no one sings" in problems[0]


def test_check_lines_clean() -> None:
    lines = [line("a", (1.0, 2.0)), line("b", (2.5, 3.0))]
    assert check_lines(lines, []) == []


def test_check_lines_overlap() -> None:
    problems = check_lines([line("a", (1.0, 3.0)), line("b", (2.0, 4.0))], [])
    assert len(problems) == 1 and "starts before" in problems[0]


def test_check_lines_squeezed() -> None:
    problems = check_lines([line("a b c", (1.0, 1.1), (1.1, 1.2), (1.2, 1.3))], [])
    assert len(problems) == 1 and "squeezed" in problems[0]


def test_check_lines_far_from_lrc() -> None:
    lines = [line("a", (1.0, 2.0)), line("b", (3.0, 4.0)), line("c", (15.0, 16.0))]
    lrc = [line("a", lrc=1.0), line("b", lrc=3.0), line("c", lrc=5.0)]
    problems = check_lines(lines, lrc)
    assert len(problems) == 1 and "«c»" in problems[0] and "from its LRC time" in problems[0]


def test_check_lines_much_shorter_than_lrc() -> None:
    lines = [line("a", (1.0, 1.3)), line("b", (3.0, 4.0))]
    lrc = [line("a", lrc=1.0), line("b", lrc=3.0)]
    problems = check_lines(lines, lrc)
    assert len(problems) == 1 and "much shorter than in the LRC" in problems[0]


def test_check_lines_without_lrc_times_skips_the_lrc_checks() -> None:
    lines = [line("a", (1.0, 1.5)), line("b", (30.0, 31.0))]
    assert check_lines(lines, [line("a"), line("b", lrc=3.0)]) == []


ASS = "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"


def event(start: str, end: str, style: str, text: str = "") -> str:
    return f"Dialogue: 0,{start},{end},{style},,0,0,0,,{text}\n"


def test_check_ass_countdown_missing_digits() -> None:
    ass = ASS + event("0:00:00.00", "0:00:04.00", "Countdown", "{\\clip(0,0,1,1)}")
    ass += event("0:00:00.00", "0:00:01.00", "Digit", "4") + event("0:00:01.00", "0:00:02.00", "Digit", "3")
    problems = check_ass(ass, [])
    assert problems == ["0:00.00 countdown shows 2 digits, not 4"]


def test_check_ass_countdown_complete() -> None:
    ass = ASS + event("0:00:00.00", "0:00:04.00", "Countdown", "{\\clip(0,0,1,1)}")
    for k in range(4):
        ass += event(f"0:00:0{k}.00", f"0:00:0{k + 1}.00", "Digit", str(4 - k))
    assert check_ass(ass, []) == []


def test_check_ass_missing_marker_after_pause() -> None:
    problems = check_ass(ASS, [line("a", (10.0, 11.0))])
    assert len(problems) == 1 and "has no marker" in problems[0]


def test_check_ass_marker_present() -> None:
    ass = ASS + event("0:00:09.00", "0:00:10.05", "Marker")
    assert check_ass(ass, [line("a", (10.0, 11.0))]) == []
