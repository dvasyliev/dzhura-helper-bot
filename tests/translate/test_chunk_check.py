import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from dzhura_helper_bot.translate import language
from dzhura_helper_bot.translate.chunk_check import Request, check_chunk


def test_fixes_the_typography_before_checking() -> None:
    reply = check_chunk(Request(source="a", translation="- П'ять \"м'ят\".", terms=[], first=False, language="uk"))
    assert reply.translation == "— Пʼять «мʼят»."
    assert reply.problems == []


def test_reports_the_problems_left_after_the_fixes() -> None:
    reply = check_chunk(
        Request(source="a\n\nb", translation="Купа дошок, объём.", terms=[], first=False, language="uk")
    )
    assert [p.kind for p in reply.problems] == ["russian-letters", "paragraphs", "russianism"]


def test_checks_glossary_terms() -> None:
    terms = [{"source": "Fogg", "uk": "Фоґ", "note": "a name"}]
    request = Request.model_validate(
        {"source": "Fogg.", "translation": "Фогг.", "terms": terms, "first": False, "language": "uk"}
    )
    assert [p.kind for p in check_chunk(request).problems] == ["glossary"]


def test_needs_the_language_of_the_translation() -> None:
    with pytest.raises(ValidationError):
        Request.model_validate({"source": "a", "translation": "b", "terms": [], "first": False})


def test_runs_the_russianism_check_only_for_a_language_with_tables(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "xx").mkdir()
    shutil.copy(language.lang_dir("uk") / "language.json", tmp_path / "xx" / "language.json")
    monkeypatch.setattr(language, "LANG_DIR", tmp_path)
    language.load.cache_clear()
    try:
        reply = check_chunk(Request(source="a", translation="Купа дошок.", terms=[], first=False, language="xx"))
    finally:
        language.load.cache_clear()
    assert reply.problems == []
