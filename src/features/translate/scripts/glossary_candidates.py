"""Words of a book likely to need a glossary entry (names of people, places, organisations), without a model call.

Reads one JSON request from stdin: {"book": "<path to book.md>", "language": "en"}
and prints one JSON line: {"candidates": [{"term": "Fogg", "count": 12, "context": "<a sentence around it>"}]}.
A language whose lang/<code>/language.json names a spaCy model (English) uses its named entities; any other
language, capitalised words in mid-sentence.
Usage: echo '{"book": "data/books/X/translation/source.md", "language": "en"}' \
  | uv run python src/features/translate/scripts/glossary_candidates.py
"""

import json
import re
import sys
import warnings
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from functools import cache
from pathlib import Path

import spacy
from pydantic import BaseModel
from spacy.language import Language as Pipeline
from spacy.tokens import Span, Token

from language import load_source, read_words

MAX_CANDIDATES = 300
MIN_COUNT = 2
MIN_TITLE_WORD = 4
MAX_CONTEXT = 120
# spaCy entity labels kept as names.
NAME_LABELS = {"PERSON", "GPE", "LOC", "ORG", "NORP", "FAC", "EVENT", "WORK_OF_ART", "PRODUCT"}
WORD = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*")
SENTENCE_END = re.compile(r"[.!?…][\"”»)]*\s")


class Request(BaseModel):
    book: Path
    language: str | None = None


@dataclass(frozen=True)
class Book:
    title: str
    paragraphs: list[str]


@dataclass
class Candidate:
    term: str
    count: int
    context: str


@dataclass(frozen=True)
class Occurrence:
    term: str
    paragraph: str
    start: int
    # A word of a person's full name: counts only for a term also found on its own.
    part: bool = False


def read_book(path: Path) -> Book:
    """book.md: YAML front matter with a quoted `title`, a `# ` line per chapter, one line per paragraph."""
    text = path.read_text(encoding="utf-8")
    front = re.match(r"---\n(.*?)\n---\n", text, re.DOTALL)
    title = re.search(r"^title: (.*)$", front.group(1), re.MULTILINE) if front else None
    body = text[front.end() if front else 0 :]
    paragraphs = [line.removeprefix("\\") for line in body.splitlines() if line.strip() and not line.startswith("# ")]
    return Book(title=json.loads(title.group(1)) if title else path.stem, paragraphs=paragraphs)


def context(paragraph: str, start: int, end: int) -> str:
    """The sentence around paragraph[start:end], cut to MAX_CONTEXT characters at word ends."""
    before = [m.end() for m in SENTENCE_END.finditer(paragraph, 0, start)]
    after = SENTENCE_END.search(paragraph, end)
    left, right = (before[-1] if before else 0), (after.start() + 1 if after else len(paragraph))
    room = max(MAX_CONTEXT - (end - start), 0) // 2
    if right - left > MAX_CONTEXT:
        left = max(left, start - room)
        right = min(right, end + room)
        left = paragraph.find(" ", left, start) + 1 if left > 0 else 0
        cut = paragraph.rfind(" ", end, right)
        right = cut if cut > 0 and right < len(paragraph) else right
    return paragraph[left:right].strip()


@cache
def ner(model: str) -> Pipeline:
    """A spaCy model with only the pipes its named entities and part-of-speech tags need.

    Loading imports spaCy's plugins, and through them torch, which warns that `torch.jit.script` is deprecated:
    not ours to fix, so that one warning is silenced instead of filling the bot's log on every run."""
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=r"`torch\.jit\.script` is deprecated", category=FutureWarning)
        return spacy.load(model, exclude=["parser", "senter", "lemmatizer"])


def name_tokens(ent: Span, titles: frozenset[str]) -> list[Token]:
    """An entity's tokens without leading and trailing stop words, punctuation and name titles (Mr.)."""
    tokens = list(ent)
    while tokens and (tokens[0].is_stop or tokens[0].is_punct or tokens[0].text.rstrip(".") in titles):
        tokens.pop(0)
    while tokens and (tokens[-1].is_stop or tokens[-1].is_punct):
        tokens.pop()
    return tokens if tokens and tokens[0].text[:1].isupper() else []


def entity_names(paragraphs: list[str], language: str, model: str) -> Iterator[Occurrence]:
    """spaCy's named entities; a person's full name also yields each of its proper nouns as a part (Peter Svidler:
    Svidler), so a name seen once in full and once alone reaches MIN_COUNT."""
    titles = read_words(language, "name-titles.txt")
    for doc in ner(model).pipe(paragraphs, batch_size=64):
        for ent in doc.ents:
            tokens = name_tokens(ent, titles) if ent.label_ in NAME_LABELS else []
            if not tokens:
                continue
            start, end = tokens[0].idx, tokens[-1].idx + len(tokens[-1].text)
            yield Occurrence(doc.text[start:end], doc.text, start)
            if ent.label_ == "PERSON" and len(tokens) > 1:
                parts = (t for t in tokens if t.pos_ == "PROPN" and t.text[:1].isupper())
                yield from (Occurrence(t.text, doc.text, t.idx, part=True) for t in parts)


def starts_sentence(before: str, titles: frozenset[str]) -> bool:
    """Whether a word after `before` (the paragraph up to it) opens a sentence, so its capital tells nothing."""
    if not before.strip():
        return True
    name_title = re.search(r"([^\W\d_]+)\.\s*$", before)
    if name_title and name_title.group(1) in titles:
        return False
    return re.search(r"[.!?…][\"”»)]*\s*$", before) is not None or re.fullmatch(r"\s*[\"“«(]*", before) is not None


def capitalised_words(paragraphs: list[str], language: str | None) -> Iterator[Occurrence]:
    """Words with a capital first letter that do not open a sentence: likely names, in any language."""
    titles = read_words(language, "name-titles.txt")
    for paragraph in paragraphs:
        for match in WORD.finditer(paragraph):
            if match.group()[0].isupper() and not starts_sentence(paragraph[: match.start()], titles):
                yield Occurrence(match.group(), paragraph, match.start())


def count(occurrences: Iterator[Occurrence]) -> dict[str, Candidate]:
    seen = list(occurrences)
    alone = {o.term for o in seen if not o.part}
    found: dict[str, Candidate] = {}
    for o in seen:
        if o.term not in alone:
            continue
        if o.term in found:
            found[o.term].count += 1
        else:
            found[o.term] = Candidate(o.term, 1, context(o.paragraph, o.start, o.start + len(o.term)))
    return found


def title_words(book: Book, language: str | None) -> list[Candidate]:
    """The title's words longer than three letters that are not stop words, counted as whole words in the text."""
    stopwords = read_words(language, "title-stopwords.txt")
    words = dict.fromkeys(
        w for w in WORD.findall(book.title) if len(w) >= MIN_TITLE_WORD and w.lower() not in stopwords
    )
    found = []
    for word in words:
        pattern = re.compile(rf"(?<![^\W\d_]){re.escape(word)}(?![^\W\d_])")
        matches = [(p, m) for p in book.paragraphs for m in pattern.finditer(p)]
        first = context(matches[0][0], matches[0][1].start(), matches[0][1].end()) if matches else book.title
        found.append(Candidate(word, len(matches), first))
    return found


def find_candidates(book: Book, language: str | None) -> list[Candidate]:
    """Title words first, then names seen at least twice, most frequent first; at most MAX_CANDIDATES."""
    model = load_source(language).ner_model
    if language and model:
        names = count(entity_names(book.paragraphs, language, model))
    else:
        names = count(capitalised_words(book.paragraphs, language))
    from_title = sorted(title_words(book, language), key=lambda c: -c.count)
    titled = {c.term for c in from_title}
    others = sorted(
        (c for c in names.values() if c.term not in titled and c.count >= MIN_COUNT), key=lambda c: -c.count
    )
    return [*from_title, *others][:MAX_CANDIDATES]


def main() -> None:
    request = Request.model_validate_json(sys.stdin.read())
    found = find_candidates(read_book(request.book), request.language)
    print(json.dumps({"candidates": [asdict(c) for c in found]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
