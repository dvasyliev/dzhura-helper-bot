import io
import json
import subprocess
import sys
from pathlib import Path

import pytest

from glossary_candidates import Book, Candidate, find_candidates, main, read_book


def book(title: str, *paragraphs: str) -> Book:
    return Book(title=title, paragraphs=list(paragraphs))


def terms(found: list[Candidate]) -> list[str]:
    return [c.term for c in found]


ENGLISH = book(
    "Around the World",
    "Phileas Fogg lived in London. Mr. Fogg left London with Passepartout.",
    "The Reform Club was quiet. The club was empty.",
    "In Bombay, Fogg met Aouda.",
)


def test_reads_the_title_and_paragraphs_of_book_md(tmp_path: Path) -> None:
    path = tmp_path / "book.md"
    text = '---\ntitle: "Around the World"\nauthor: "Jules Verne"\n---\n\n# One\n\nFirst.\n\n\\# Second.\n'
    path.write_text(text, encoding="utf-8")
    assert read_book(path) == Book(title="Around the World", paragraphs=["First.", "# Second."])


def test_finds_english_names_seen_at_least_twice_with_their_context() -> None:
    found = {c.term: c for c in find_candidates(ENGLISH, "en")}
    assert found["Fogg"].count >= 2
    assert found["London"].count == 2
    assert "Fogg" in found["Fogg"].context
    assert "Reform Club" not in found
    assert "The" not in found


def test_counts_a_part_of_a_full_name_when_the_part_is_also_used_alone() -> None:
    text = "Yesterday I met Carol Dweck at the club. Later that day Carol talked about chess."
    found = {c.term: c for c in find_candidates(book("T", text), "en")}
    assert found["Carol"].count == 2


def test_skips_parts_of_full_names_never_used_alone() -> None:
    text = "Yesterday I met Carol Dweck at the club. Later that day I talked with Carol Jarecki about chess."
    assert "Carol" not in terms(find_candidates(book("T", text), "en"))


def test_drops_name_titles_from_english_names() -> None:
    assert not any(term.startswith("Mr") for term in terms(find_candidates(ENGLISH, "en")))


def test_puts_title_words_first_without_stopwords() -> None:
    found = terms(find_candidates(ENGLISH, "en"))
    assert found[0] == "World"
    assert "Around" not in found


def test_keeps_the_context_short() -> None:
    long = "word " * 60
    found = find_candidates(book("T", f"{long}Fogg came {long}and Fogg left {long}."), "en")
    fogg = next(c for c in found if c.term == "Fogg")
    assert len(fogg.context) <= 120
    assert "Fogg" in fogg.context


def test_finds_capitalised_words_mid_sentence_in_any_other_language() -> None:
    found = {c.term: c for c in find_candidates(book("Буря", "Вчера Тарас пришёл. Потом Тарас ушёл к Оксане."), "ru")}
    assert found["Тарас"].count == 2
    assert "Потом" not in found
    assert "Оксане" not in found
    assert next(iter(found)) == "Буря"


def test_keeps_at_most_300() -> None:
    names = [f"Name{chr(65 + i // 26)}{chr(65 + i % 26)}" for i in range(400)]
    text = " ".join(f"go {name} and {name}." for name in names)
    assert len(find_candidates(book("T", text), None)) == 300


def test_main_prints_one_json_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "book.md"
    path.write_text('---\ntitle: "Буря"\n---\n\n# Один\n\nВчера Тарас пришёл. Потом Тарас ушёл.\n', encoding="utf-8")
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"book": str(path), "language": "ru"})))
    main()
    reply = json.loads(capsys.readouterr().out)
    assert [c["term"] for c in reply["candidates"]] == ["Буря", "Тарас"]


def test_prints_no_torch_deprecation_warning(tmp_path: Path) -> None:
    path = tmp_path / "book.md"
    path.write_text('---\ntitle: "T"\n---\n\n# One\n\nFogg came. Then Fogg left.\n', encoding="utf-8")
    script = Path(__file__).with_name("glossary_candidates.py")
    request = json.dumps({"book": str(path), "language": "en"})
    result = subprocess.run([sys.executable, script], input=request, capture_output=True, text=True, check=True)  # noqa: S603
    assert "FutureWarning" not in result.stderr
