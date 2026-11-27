import io
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from dzhura_helper_bot.audiobook import voice
from dzhura_helper_bot.audiobook.voice import Job

JOB = {
    "provider": "holos",
    "language": "uk",
    "voice": "Speaker_0",
    "text_dir": "t",
    "audio_dir": "a",
    "dictionary": "d.txt",
    "chapters": [{"index": 0, "name": "001", "text": "Привіт."}],
}


def test_job_defaults_optional_fields():
    job = Job.model_validate(JOB)
    assert (job.report, job.tempo, job.one_file) == (None, 1.0, False)


def test_job_without_a_voice_is_rejected():
    with pytest.raises(ValidationError, match="voice"):
        Job.model_validate({k: v for k, v in JOB.items() if k != "voice"})


def run_main(monkeypatch, capsys, provider, chapters: int = 2) -> list[dict]:
    job = {**JOB, "chapters": [{"index": i, "name": f"00{i}", "text": "Привіт."} for i in range(chapters)]}
    monkeypatch.setattr(voice.sys, "stdin", io.StringIO(json.dumps(job)))
    monkeypatch.setitem(voice.PROVIDERS, "holos", lambda: provider)
    monkeypatch.setitem(voice.PREPARE, "uk", lambda *_: "text.txt")
    monkeypatch.setattr(voice, "ProcessPoolExecutor", ThreadPoolExecutor)
    monkeypatch.setattr(voice.Path, "read_text", lambda *_, **__: "Привіт.")
    monkeypatch.setattr(voice, "apply_dictionary", lambda text, _: text)
    monkeypatch.setattr(voice, "load_stress", lambda _: {})
    monkeypatch.setattr(voice, "change_tempo", lambda data, _: data)
    monkeypatch.setattr(voice, "save", lambda parts, _dir, name: [f"{name}.mp3"])
    voice.main()
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


def test_a_chapter_failing_twice_reports_its_real_error_and_stops(monkeypatch, tmp_path, capsys):
    calls: list[str] = []

    def provider(text: str, _voice: str) -> list[bytes]:
        calls.append(text)
        raise RuntimeError("model crashed")

    monkeypatch.setitem(JOB, "text_dir", str(tmp_path / "t"))
    monkeypatch.setitem(JOB, "audio_dir", str(tmp_path / "a"))
    lines = run_main(monkeypatch, capsys, provider)
    assert lines == [{"chapter": 0, "error": "model crashed"}]
    assert len(calls) == 2


def test_a_chapter_failing_once_is_retried_and_voiced(monkeypatch, tmp_path, capsys):
    calls: list[str] = []

    def provider(text: str, _voice: str) -> list[bytes]:
        calls.append(text)
        if len(calls) == 1:
            raise RuntimeError("hiccup")
        return [b"mp3"]

    monkeypatch.setitem(JOB, "text_dir", str(tmp_path / "t"))
    monkeypatch.setitem(JOB, "audio_dir", str(tmp_path / "a"))
    lines = run_main(monkeypatch, capsys, provider, chapters=1)
    assert lines == [{"chapter": 0, "files": ["000.mp3"]}]
    assert len(calls) == 2
