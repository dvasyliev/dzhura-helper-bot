"""What the checks, fixes and glossary candidates need to know about a language, read from ../lang/<code>/language.json.

A translation's language (`load`) needs its letters, quotes and dashes; a book's language (`load_source`) needs
nothing, and its settings default to the language-independent rules."""

import json
import unicodedata
from functools import cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

LANG_DIR = Path(__file__).resolve().parent.parent / "lang"

# How a glossary term is found in a text: as "whole" words (English: Fogg, Fogg's; not Brazil in Brazilian), or by
# "stem" for a language that declines names (Шекспир: Шекспира, Шекспиром). The rule is `word_pattern` in checks.py and
# `wordPattern` in check.ts.
TermMatch = Literal["whole", "stem"]


class Language(BaseModel):
    model_config = ConfigDict(frozen=True)

    # The folder name under lang/ ("uk"); set by `load`, not written in language.json.
    code: str

    # The Unicode script of the language's letters, as in Unicode character names ("Cyrillic").
    script: str
    # Letters of the script that do not belong to the language.
    foreign_letters: str
    apostrophe: str
    # Characters typed in place of the apostrophe.
    apostrophe_variants: str
    quotes: tuple[str, str]
    inner_quotes: tuple[str, str]
    dialogue_dash: str
    # Characters typed in place of the dialogue dash.
    dialogue_dash_variants: str
    term_match: TermMatch = "stem"


class Source(BaseModel):
    """A book's language: every field is optional in its language.json, and a language without one gets the defaults."""

    model_config = ConfigDict(frozen=True)

    # The spaCy model whose named entities give the glossary candidates; without one, capitalised words do.
    ner_model: str | None = None
    term_match: TermMatch = "stem"


def lang_dir(code: str) -> Path:
    return LANG_DIR / code


@cache
def load(code: str) -> Language:
    data = json.loads((lang_dir(code) / "language.json").read_text(encoding="utf-8"))
    return Language.model_validate({**data, "code": code})


@cache
def load_source(code: str | None) -> Source:
    path = lang_dir(code or "") / "language.json"
    if not code or not path.is_file():
        return Source()
    return Source.model_validate_json(path.read_text(encoding="utf-8"))


@cache
def read_words(code: str | None, name: str) -> frozenset[str]:
    """The lines of lang/<code>/<name>, without blank lines and `#` comments; empty when the file does not exist."""
    path = lang_dir(code or "") / name
    if not code or not path.is_file():
        return frozenset()
    lines = path.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip() for line in lines if line.strip() and not line.startswith("#"))


def in_script(char: str, script: str) -> bool:
    """Whether `char` is a letter of `script` ("Latin", "Cyrillic"), by its Unicode name."""
    return unicodedata.name(char, "").startswith(f"{script.upper()} ")
