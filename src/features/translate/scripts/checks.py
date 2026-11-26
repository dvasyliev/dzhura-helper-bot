"""Mechanical checks of a translated chunk against its source; none of them is specific to one language."""

import re
from dataclasses import dataclass

from pydantic import BaseModel

from language import Language, TermMatch, in_script

LETTERS = re.compile(r"[^\W\d_]+")
ROMAN = re.compile(r"[IVXLCDM]+")
PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


class Term(BaseModel):
    """A glossary entry: how a source name or term must be written in the translation."""

    source: str
    uk: str
    note: str | None = None


@dataclass(frozen=True)
class Problem:
    kind: str
    detail: str


def paragraphs(text: str) -> list[str]:
    """Splits text on blank lines; paragraphs are trimmed and empty ones dropped (as `paragraphs` in chunks.ts)."""
    return [p.strip() for p in PARAGRAPH_BREAK.split(text) if p.strip()]


def check_latin(source: str, translation: str, lang: Language) -> list[Problem]:
    """A word mixing Latin with the language's script, or a Latin word absent from the source (Roman numerals pass)."""
    source_words = {word.lower() for word in LETTERS.findall(source)}
    problems = []
    for word in LETTERS.findall(translation):
        latin = any(in_script(char, "Latin") for char in word)
        mixed = latin and any(in_script(char, lang.script) for char in word)
        foreign = latin and not ROMAN.fullmatch(word) and word.lower() not in source_words
        if mixed or foreign:
            problems.append(Problem("latin", word))
    return problems


def check_foreign_letters(translation: str, lang: Language) -> list[Problem]:
    found = dict.fromkeys(char for char in translation if char in lang.foreign_letters)
    return [Problem("russian-letters", " ".join(found))] if found else []


def check_paragraphs(source: str, translation: str) -> list[Problem]:
    before, after = len(paragraphs(source)), len(paragraphs(translation))
    if before == after:
        return []
    return [Problem("paragraphs", f"{before} in the source, {after} in the translation")]


HEADING = re.compile(r"^#{1,3} ", re.MULTILINE)


def check_title(translation: str, first: bool | None) -> list[Problem]:
    """A chunk that opens a chapter must start with its `#` title line (`##`, `###` for a section); no other may."""
    if first is True and not HEADING.match(translation):
        return [Problem("title", "the # title line is missing")]
    if first is False and HEADING.search(translation):
        return [Problem("title", "a # title line in a chunk that does not open a chapter")]
    return []


def normalize(text: str, lang: Language) -> str:
    """Lowercase, with every apostrophe as '."""
    return re.sub(f"[{re.escape(lang.apostrophe + lang.apostrophe_variants)}]", "'", text.lower())


def word_pattern(word: str, match: TermMatch) -> str:
    """A word of a glossary term, as `wordPattern` in check.ts: "whole", the word itself; "stem", its stem (all but
    the last two letters, at least four) and at most three letters more than the word has."""
    if match == "whole":
        return re.escape(word)
    stem = word[: max(len(word) - 2, 4)]
    return rf"{re.escape(stem)}[^\W\d_]{{0,{len(word) + 3 - len(stem)}}}"


def term_holds(term: Term, translation: str, lang: Language) -> bool:
    """Every word of the term's translation starts a word of the text, matched by `word_pattern`
    (Чен: Чена, Ченові; not значення)."""
    text = normalize(translation, lang)
    words = re.findall(r"(?:[^\W\d_]|['-])+", normalize(term.uk, lang))
    return all(re.search(rf"(?<![^\W\d_']){word_pattern(word, lang.term_match)}(?![^\W\d_'])", text) for word in words)


def check_glossary(translation: str, terms: list[Term], lang: Language) -> list[Problem]:
    """Every term given must hold; the caller (hasTerm in check.ts) passes only the terms present in the source."""
    return [
        Problem("glossary", f"{term.source} should be {term.uk}")
        for term in terms
        if not term_holds(term, translation, lang)
    ]


def check(source: str, translation: str, terms: list[Term], first: bool | None, lang: Language) -> list[Problem]:
    """All checks above; an empty list means nothing was found. `first` (when given) says whether the chunk opens a chapter."""
    return [
        *check_latin(source, translation, lang),
        *check_foreign_letters(translation, lang),
        *check_paragraphs(source, translation),
        *check_title(translation, first),
        *check_glossary(translation, terms, lang),
    ]
