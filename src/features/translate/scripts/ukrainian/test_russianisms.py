import pytest

from language import load
from ukrainian.russianisms import Replacement, Russianisms, load_table, read_table

UK = load("uk")


def found(text: str, table: list[Replacement]) -> list[str]:
    return [problem.detail for problem in Russianisms(table, UK).find(text)]


def test_flags_a_table_phrase_and_names_the_suggestion() -> None:
    table = [Replacement("так от", ("отож",))]
    assert found("Так от, ми пішли.", table) == ['"так от": отож']


def test_does_not_match_a_phrase_across_punctuation() -> None:
    assert found("Так, от ми.", [Replacement("так от", ("отож",))]) == []


def test_matches_a_single_word_only_in_its_own_form() -> None:
    table = [Replacement("хвилюючий", ("що хвилює",))]
    assert len(found("Хвилюючий день.", table)) == 1
    assert found("хвилюватися", table) == []


def test_matches_a_dictionary_form_in_a_phrase_with_its_other_forms() -> None:
    table = [Replacement("приймати участь", ("брати участь",))]
    assert len(found("Він приймав участь у бою.", table)) == 1
    assert found("Він приймав гостей, участь була.", table) == []


def test_treats_apostrophes_alike() -> None:
    assert len(found("Це м’який знак.", [Replacement("м'який знак", ("х",))])) == 1


def test_drops_advice_rows_allowed_words_and_words_wrong_only_inside_a_set_phrase() -> None:
    patterns = {row.pattern for row in load_table(UK)}
    for word in ["любий", "образу", "єдиного", "рівна", "прийом", "сходу"]:
        assert word not in patterns
    for word in ["дошок", "заможній", "крупний", "приймати участь"]:
        assert word in patterns


def test_takes_the_shortest_table_word_from_the_tables_settings() -> None:
    assert len(read_table("uk", 1)) > len(load_table(UK)) == len(read_table("uk", 5))


def test_has_many_rows_and_no_advice_rows() -> None:
    table = load_table(UK)
    # lt-replace.tsv has 10,444 rows, 1,707 of them advice
    assert 1000 < len(table) < 9000
    assert all(row.suggestions for row in table)


@pytest.mark.parametrize(
    "text",
    [
        "Купа дошок.",
        "Заможній купець.",
        "Будучи вдома.",
        "Хвилюючий день.",
        "Він приймав участь.",
        "Вони прийняли участь.",
    ],
)
def test_flags_real_errors_with_the_real_table(text: str) -> None:
    assert Russianisms(load_table(UK), UK).find(text)


@pytest.mark.parametrize(
    "text", ["Вітер зі сходу.", "Прийом був теплий.", "На відміну від нього.", "Він приймав гостей."]
)
def test_leaves_correct_ukrainian_alone(text: str) -> None:
    assert Russianisms(load_table(UK), UK).find(text) == []
