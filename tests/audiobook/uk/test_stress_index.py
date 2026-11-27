from pathlib import Path

import pytest
import requests
import responses

from dzhura_helper_bot.audiobook.uk import stress_index

JSONL = '{"forms": [{"form": "за́мок", "tags": []}, {"form": "zamok", "tags": ["romanization"]}]}\n'
CSV = "Heteronym\nЗамок\n"


@pytest.fixture
def index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "cache" / "stress.json"
    monkeypatch.setattr(stress_index, "INDEX", str(path))
    return path


@responses.activate
def test_main_writes_the_index(index: Path) -> None:
    responses.add(responses.GET, stress_index.WIKTIONARY, body=JSONL)
    responses.add(responses.GET, stress_index.HOMOGRAPHS, body=CSV)
    stress_index.main()
    assert '"замок": ["за́мок"]' in index.read_text(encoding="utf-8")
    assert '"homographs": ["замок"]' in index.read_text(encoding="utf-8")


@responses.activate
def test_main_server_error_leaves_no_index(index: Path) -> None:
    responses.add(responses.GET, stress_index.WIKTIONARY, status=500)
    with pytest.raises(requests.HTTPError):
        stress_index.main()
    assert not index.exists()


@responses.activate
def test_main_homographs_error_leaves_no_index(index: Path) -> None:
    responses.add(responses.GET, stress_index.WIKTIONARY, body=JSONL)
    responses.add(responses.GET, stress_index.HOMOGRAPHS, status=500)
    with pytest.raises(requests.HTTPError):
        stress_index.main()
    assert not index.exists()


@responses.activate
def test_main_timeout_leaves_no_index(index: Path) -> None:
    responses.add(responses.GET, stress_index.WIKTIONARY, body=requests.ConnectTimeout())
    with pytest.raises(requests.Timeout):
        stress_index.main()
    assert not index.exists()
