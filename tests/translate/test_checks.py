from dzhura_helper_bot.translate.checks import Term, check
from dzhura_helper_bot.translate.language import load

UK = load("uk")


def kinds(source: str, translation: str, terms: list[Term] | None = None, first: bool | None = None) -> list[str]:
    return [problem.kind for problem in check(source, translation, terms or [], first, UK)]


def test_flags_a_word_mixing_latin_and_cyrillic_letters() -> None:
    assert kinds("a", "statок") == ["latin"]
    assert kinds("a", "лордa") == ["latin"]


def test_allows_a_whole_latin_word_from_the_source() -> None:
    assert kinds("He bought an iPhone.", "Він купив iPhone.") == []


def test_flags_a_whole_latin_word_that_is_not_in_the_source() -> None:
    assert kinds("He drank wine.", "Він пив claret.") == ["latin"]


def test_allows_roman_numerals() -> None:
    assert kinds("In the eleventh century.", "У XI ст. та IV.") == []


def test_flags_foreign_letters() -> None:
    problems = check("a", "объём", [], None, UK)
    assert [p.kind for p in problems] == ["russian-letters"]
    assert problems[0].detail == "ъ ё"
    assert kinds("a", "Мы пошли.") == ["russian-letters"]


def test_flags_a_different_paragraph_count() -> None:
    assert kinds("a\n\nb\n\nc", "а\n\nб") == ["paragraphs"]
    assert kinds("a\n \nb\n\n\n", "а\n\n  \n\nб") == []


def test_checks_glossary_terms_by_their_stem() -> None:
    terms = [Term(source="Fogg", uk="Фоґ")]
    assert kinds("Fogg came.", "Фоґові прийшов.", terms) == []
    assert kinds("Fogg came.", "Фогг прийшов.", terms) == ["glossary"]


def test_takes_all_but_the_last_two_letters_of_a_five_letter_form_as_its_stem() -> None:
    terms = [Term(source="India", uk="Індія"), Term(source="Maria", uk="Марія")]
    assert kinds("India and Maria.", "Індії та Марії.", terms) == []


def test_finds_a_glossary_form_only_at_a_word_start() -> None:
    terms = [Term(source="Chen", uk="Чен")]
    assert kinds("Chen came.", "Це значення.", terms) == ["glossary"]
    assert kinds("Chen came.", "Учень Ченові сказав.", terms) == []


def test_checks_every_glossary_term_it_is_given() -> None:
    # The caller (hasTerm in check.ts) picks the terms present in the source, in any of their forms.
    assert kinds("Шекспира нет.", "Він прийшов.", [Term(source="Шекспир", uk="Шекспір")]) == ["glossary"]


def test_flags_a_first_chunk_that_loses_its_title_line() -> None:
    assert kinds("# One\n\nText.", "Один\n\nТекст.", first=True) == ["title"]
    assert kinds("# One\n\nText.", "# Один\n\nТекст.", first=True) == []
    assert kinds("## One\n\nText.", "## Один\n\nТекст.", first=True) == []


def test_flags_a_title_line_in_a_chunk_that_is_not_first() -> None:
    assert kinds("Text.\n\nMore.", "# Текст.\n\nЩе.", first=False) == ["title"]
