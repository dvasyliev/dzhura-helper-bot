import pytest

from language import load
from typography import fix_apostrophes, fix_dialogue, fix_quotes, fix_typography

UK = load("uk")


def test_puts_the_ukrainian_apostrophe_between_cyrillic_letters() -> None:
    assert fix_apostrophes("п'ять, м’ята, 'quoted' don't", UK) == "пʼять, мʼята, 'quoted' don't"


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ('Він сказав "так".', "Він сказав «так»."),
        ('"Він сказав "так" і пішов"', "«Він сказав „так“ і пішов»"),
        ('«Він сказав "так"»', "«Він сказав „так“»"),
        ('Слово "yes" тут.', 'Слово "yes" тут.'),
        ('Він "сказав.', 'Він "сказав.'),
        ('"Один".\n\n"Два".', "«Один».\n\n«Два»."),
    ],
)
def test_puts_ukrainian_quotes_around_cyrillic_text(given: str, expected: str) -> None:
    assert fix_quotes(given, UK) == expected


def test_opens_quotes_after_the_languages_dialogue_dashes() -> None:
    lang = UK.model_copy(update={"dialogue_dash_variants": "~"})
    assert fix_quotes('~"так"', lang) == "~«так»"


def test_puts_the_dialogue_dash_at_a_paragraph_start() -> None:
    given = "- Так, - сказав він.\n\n– Ні.\n\nСлово - не дія."
    assert fix_dialogue(given, UK) == "— Так, - сказав він.\n\n— Ні.\n\nСлово - не дія."


def test_applies_all_fixes() -> None:
    assert fix_typography('- Пʼять "м\'ят".', UK) == "— Пʼять «мʼят»."
