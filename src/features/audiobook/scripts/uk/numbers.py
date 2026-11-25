"""Spells out numbers in Ukrainian text, with the case the common book patterns need."""

import re

from num2words import num2words

MONTHS = "січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня"
# Heading word → gender of the ordinal that follows it («Розділ перший», «Частина перша»).
HEADINGS = {"розділ": "m", "частина": "f", "глава": "f", "книга": "f", "том": "m", "дія": "f", "сцена": "f"}
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


def cardinal(n: int) -> str:
    return re.sub(r"^одна тисяча", "тисяча", num2words(n, lang="uk"))


def ordinal(n: int, form: str = "m") -> str:
    """form: m (nominative masculine), f (nominative feminine), gen (genitive), loc (locative)."""
    words = re.sub(r"^одна тисяча", "тисяча", num2words(n, lang="uk", to="ordinal"))
    soft = words.endswith("ій")  # третій
    stem = words[:-2]
    endings = {
        "m": "ій" if soft else "ий",
        "f": "я" if soft else "а",
        "gen": "ього" if soft else "ого",
        "loc": "ьому" if soft else "ому",
    }
    return stem + endings[form]


def roman(s: str) -> int:
    values = [ROMAN[c] for c in s]
    return sum(-v if i + 1 < len(values) and v < values[i + 1] else v for i, v in enumerate(values))


def numbers_to_words(text: str) -> str:
    heading = "|".join(HEADINGS)
    text = re.sub(
        rf"\b({heading})\s+([IVXLC]+|\d+)\b",
        lambda m: f"{m[1]} {ordinal(roman(m[2]) if m[2][0] in ROMAN else int(m[2]), HEADINGS[m[1].lower()])}",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(rf"\b(\d+)(?=\s+(?:{MONTHS})\b)", lambda m: ordinal(int(m[1]), "gen"), text)
    text = re.sub(r"\b(\d+)(?=\s+року\b)", lambda m: ordinal(int(m[1]), "gen"), text)
    text = re.sub(r"\b(\d+)(?=\s+році\b)", lambda m: ordinal(int(m[1]), "loc"), text)
    text = re.sub(r"\b(\d+)(?=\s+рік\b)", lambda m: ordinal(int(m[1]), "m"), text)
    return re.sub(r"\b\d+\b", lambda m: cardinal(int(m[0])), text)
