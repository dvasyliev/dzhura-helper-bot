"""The stress data downloads by itself on the first Ukrainian book, so setup needs no separate step."""

from pathlib import Path

import pytest

from dzhura_helper_bot.audiobook.uk import prepare, stress_index


@pytest.fixture(autouse=True)
def fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(prepare, "_index", None)


def test_a_missing_index_is_built(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "stress.json"
    monkeypatch.setattr(stress_index, "INDEX", str(path))
    monkeypatch.setattr(
        stress_index,
        "build",
        lambda: path.write_text('{"forms": {"замок": ["за́мок"]}, "homographs": ["замок"]}', encoding="utf-8"),
    )
    assert prepare.stress_index() == ({"замок": ["за́мок"]}, {"замок"})


def test_a_failed_build_goes_on_without_the_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(stress_index, "INDEX", str(tmp_path / "stress.json"))

    def offline() -> None:
        raise OSError("no network")

    monkeypatch.setattr(stress_index, "build", offline)
    assert prepare.stress_index() == ({}, set())


def test_the_stress_model_downloads_only_when_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    downloads: list[bool] = []
    monkeypatch.setattr(prepare, "ACCENTUK_CACHE", tmp_path)
    monkeypatch.setattr(prepare, "download_assets", lambda *, light: downloads.append(light))
    prepare.ensure_stress_model()
    assert downloads == [True]
    (tmp_path / "manifest.json").write_text("{}")
    prepare.ensure_stress_model()
    assert downloads == [True]
