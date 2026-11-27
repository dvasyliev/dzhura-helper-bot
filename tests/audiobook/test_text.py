import json
import os
import tempfile
from pathlib import Path

import pytest

from dzhura_helper_bot.audiobook.uk.abbreviations import expand_abbreviations
from dzhura_helper_bot.audiobook.uk import prepare
from dzhura_helper_bot.audiobook.uk import stress_index as index_builder
from dzhura_helper_bot.audiobook.uk.prepare import apply_dictionary, load_dictionary, prepare_text
from dzhura_helper_bot.audiobook.sentences import MAX_SENTENCE_CHARS, pack, split_sentences
from dzhura_helper_bot.audiobook.voice import keep_text, save


def test_split_sentences() -> None:
    assert split_sentences("Перше речення. Друге!  Третє?") == ["Перше речення.", "Друге!", "Третє?"]
    assert split_sentences(" – … ") == [], "pieces with no letters are dropped"

    long = ", ".join(["слово " * 10] * 10)
    pieces = split_sentences(long)
    assert all(len(p) <= MAX_SENTENCE_CHARS for p in pieces), [len(p) for p in pieces]
    assert " ".join(pieces).split() == long.split(), "no words lost"


def test_pack() -> None:
    assert pack(["аа.", "бб.", "вв."], 7) == ["аа. бб.", "вв."]
    assert pack(["задовге речення"], 5) == ["задовге речення"], "a piece longer than the limit stays whole"


def test_keep_text() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "001 Chapter.txt")
        assert keep_text("In 1864 he paid $5.", path, "") == path
        assert open(path, encoding="utf-8").read() == "In 1864 he paid $5.", "saved as written"
        keep_text("Other text.", path, "")
        assert open(path, encoding="utf-8").read() == "In 1864 he paid $5.", "an edited file is kept"


def test_abbreviations() -> None:
    abbreviations = {
        "26 липня 1864 р. вони": "26 липня 1864 року вони",
        "у 1864 р. вони": "у 1864 році вони",
        "на початку XIX ст.": "на початку дев'ятнадцятого століття",
        "у XIX ст.": "у дев'ятнадцятому столітті",
        "21 км, 3 км і 5 км": "21 кілометр, 3 кілометри і 5 кілометрів",
        "12 % і 2%": "12 відсотків і 2 відсотки",
        "£5 і $1": "5 фунтів і 1 долар",
        "каюта № 6": "каюта номер 6",
        "столи, стільці і т. д. Далі": "столи, стільці і так далі Далі",
        "моря тощо – Прим. ред.": "моря тощо – Примітка редакції",
        "Том мав 5 метрів": "Том мав 5 метрів",
        "3 м’ячі": "3 м’ячі",
    }
    for given, expected in abbreviations.items():
        assert expand_abbreviations(given) == expected, (given, expand_abbreviations(given))


def test_dictionary_applies_stress_to_listed_words(tmp_path: Path) -> None:
    (tmp_path / "stress.txt").write_text("# names\nГленарва́н\nїї́  # pronoun\n")
    words = load_dictionary(str(tmp_path / "stress.txt"))
    assert apply_dictionary("Гле́нарван і ГЛЕНАРВАН, а́ її", words) == "Гленарва́н і ГЛЕНАРВА́Н, а́ її́"


def test_dictionary_leaves_other_forms(tmp_path: Path) -> None:
    (tmp_path / "stress.txt").write_text("Гленарва́н\n")
    words = load_dictionary(str(tmp_path / "stress.txt"))
    assert apply_dictionary("п’ять Гленарвана", words) == "п’ять Гленарвана"


def test_save_one_part_and_many(tmp_path: Path) -> None:
    d = str(tmp_path)
    assert save([b"a"], d, "001 Розділ") == [f"{d}/001 Розділ.mp3"]
    assert save([b"a", b"b"], d, "002 Розділ") == [f"{d}/002 Розділ (1).mp3", f"{d}/002 Розділ (2).mp3"]
    assert not [n for n in os.listdir(d) if n.endswith(".part")]


@pytest.fixture
def stress_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    index = tmp_path / "stress.json"
    index.write_text(
        json.dumps({"forms": {"йому": ["йому́"], "замок": ["замо́к", "за́мок"]}, "homographs": ["замок"]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(index_builder, "INDEX", str(index))
    monkeypatch.setattr(prepare, "_index", None)


def prepared(tmp_path: Path, text: str, book_words: str = "") -> tuple[str, list[str], list[str]]:
    (tmp_path / "book.txt").write_text(book_words, encoding="utf-8")
    return prepare_text(text, str(tmp_path / "book.txt"))


@pytest.mark.usefixtures("stress_index")
def test_prepare_text_book_dictionary_wins_over_model(tmp_path: Path) -> None:
    text, _, _ = prepared(tmp_path, "У 1864 р. майорів прапор.", "майорі́в\n")
    assert "майорі́в" in text


@pytest.mark.usefixtures("stress_index")
def test_prepare_text_numbers_in_words(tmp_path: Path) -> None:
    text, _, _ = prepared(tmp_path, "У 1864 р. майорів прапор.")
    assert "ти́сяча вісімсо́т" in text


@pytest.mark.usefixtures("stress_index")
def test_prepare_text_index_fixes_a_guessed_stress(tmp_path: Path) -> None:
    text, _, _ = prepared(tmp_path, "Йому дали книжку.")
    assert "Йому́" in text


@pytest.mark.usefixtures("stress_index")
def test_prepare_text_applies_stress_rules(tmp_path: Path) -> None:
    text, _, _ = prepared(tmp_path, "Його книжка була тут. Він пішов, коли почув.")
    assert text.startswith("Його́ кни́жка була́ ")
    assert "коли́ почу́в" in text


@pytest.mark.usefixtures("stress_index")
def test_prepare_text_reports_homographs(tmp_path: Path) -> None:
    _, _, homographs = prepared(tmp_path, "Він відкрив замок.")
    assert any(h.replace("́", "") == "замок" for h in homographs), homographs


def offline() -> tuple[int, int]:
    raise OSError("no network")


def test_prepare_text_without_index_still_works(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(index_builder, "INDEX", str(tmp_path / "missing.json"))
    monkeypatch.setattr(index_builder, "build", offline)
    monkeypatch.setattr(prepare, "_index", None)
    text, _, _ = prepared(tmp_path, "Його книжка була тут.")
    assert text.startswith("Його́ кни́жка")
