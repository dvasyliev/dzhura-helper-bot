"""Russianisms and calques from the tables in ../lang/uk/russianisms/, minus the words in allowed.txt.

A one-word row matches only its own form: the tables often name one wrong form of a correct word
("додаш" for "додаси"), and matching the other forms flagged most of a published translation.
A row of several words matches them in a row with no punctuation between; a word of it given in its
dictionary form ("приймати участь") also matches its other forms ("приймав участь").
"""

import csv
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from pydantic import BaseModel

from checks import Problem, normalize
from language import Language, lang_dir
from ukrainian.morphology import forms

WORD = re.compile(r"(?:[^\W\d_]|['-])+")
PUNCTUATION = re.compile(r"[^\w\s'-]")


@dataclass(frozen=True)
class Replacement:
    pattern: str
    suggestions: tuple[str, ...]


def russianisms_dir(code: str) -> Path:
    return lang_dir(code) / "russianisms"


def read_rows(code: str, name: str) -> list[dict[str, str]]:
    with open(russianisms_dir(code) / name, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def read_allowed(code: str) -> set[str]:
    lines = (russianisms_dir(code) / "allowed.txt").read_text(encoding="utf-8").splitlines()
    return {line.strip() for line in lines if line.strip() and not line.startswith("#")}


def only_in_phrase(pattern: str, note: str) -> bool:
    """An lt-replace row of one word whose note is a phrase ("Образ життя"): the word is wrong only inside it.
    A note listing more synonyms has `;`."""
    return " " not in pattern and " " in note and ";" not in note


class Settings(BaseModel):
    # Shorter one-word rows of the tables ("в", "по") depend on context and flag ordinary text.
    min_word: int


def has_tables(code: str) -> bool:
    """Whether lang/<code>/ has russianism tables: only then is the translation checked against them."""
    return russianisms_dir(code).is_dir()


def load_table(lang: Language) -> list[Replacement]:
    """The table for `lang`, read once per process."""
    settings = Settings.model_validate_json((russianisms_dir(lang.code) / "settings.json").read_text(encoding="utf-8"))
    return read_table(lang.code, settings.min_word)


@cache
def read_table(code: str, min_word: int) -> list[Replacement]:
    """The `error` rows of lt-replace.tsv and chysto-calques.tsv, without allowed.txt and short or phrase-bound words."""
    allowed = read_allowed(code)
    rows = []
    for row in read_rows(code, "lt-replace.tsv"):
        pattern, note = row["pattern"] or "", row["note"] or ""
        if (
            row["level"] == "error"
            and row["suggestions"]
            and (len(pattern) >= min_word or " " in pattern)
            and not only_in_phrase(pattern, note)
        ):
            rows.append((pattern, row["suggestions"]))
    rows += [
        (row["pattern"], row["suggestions"]) for row in read_rows(code, "chysto-calques.tsv") if row["level"] == "error"
    ]
    return [
        Replacement(pattern, tuple(suggestions.split("|")))
        for pattern, suggestions in rows
        if pattern and suggestions and pattern not in allowed
    ]


class Russianisms:
    def __init__(self, table: list[Replacement], lang: Language) -> None:
        self.normalize = lambda text: normalize(text, lang)
        self.words: dict[str, list[Replacement]] = {}
        self.phrases: list[tuple[Replacement, list[frozenset[str]]]] = []
        for row in table:
            words = self.normalize(row.pattern).split()
            if len(words) == 1:
                self.words.setdefault(words[0], []).append(row)
            else:
                self.phrases.append((row, [forms(word, lang.code) for word in words]))

    def find(self, text: str) -> list[Problem]:
        normalized = self.normalize(text)
        segments = [self.tokens(part) for part in PUNCTUATION.split(normalized)]
        hits = {row: None for word in self.tokens(normalized) for row in self.words.get(word, [])}
        for row, words in self.phrases:
            if any(self.has_phrase(segment, words) for segment in segments):
                hits[row] = None
        return [Problem("russianism", f'"{row.pattern}": {", ".join(row.suggestions)}') for row in hits]

    @staticmethod
    def tokens(text: str) -> list[str]:
        return [word.strip("'-") for word in WORD.findall(text)]

    @staticmethod
    def has_phrase(segment: list[str], words: list[frozenset[str]]) -> bool:
        size = len(words)
        return any(all(segment[i + j] in words[j] for j in range(size)) for i in range(len(segment) - size + 1))
