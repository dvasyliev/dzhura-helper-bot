"""Fixes the typography of a translated chunk and checks it against its source, without a model.

Reads one JSON request from stdin:
  {"source": "...", "translation": "...", "terms": [{"source": "Fogg", "uk": "Фоґ", "note": "..."}], "first": true,
   "language": "uk"}
and prints one JSON line: {"translation": "<the text after the fixes>", "problems": [{"kind": "...", "detail": "..."}]}.
`first` says whether the chunk opens a chapter (and so starts with its `# ` title line).
Usage: echo '{"source": "a", "translation": "Пʼять", "terms": [], "first": false, "language": "uk"}' \
  | uv run python src/features/translate/scripts/chunk_check.py
"""

import json
import sys
from dataclasses import asdict

from pydantic import BaseModel

from checks import Problem, Term, check
from language import load
from typography import fix_typography
from ukrainian.russianisms import Russianisms, has_tables, load_table


class Request(BaseModel):
    source: str
    translation: str
    terms: list[Term]
    first: bool
    # The translation's language: its folder under lang/ ("uk").
    language: str


class Reply(BaseModel):
    translation: str
    problems: list[Problem]


def check_chunk(request: Request) -> Reply:
    lang = load(request.language)
    translation = fix_typography(request.translation, lang)
    problems = [
        *check(request.source, translation, request.terms, request.first, lang),
    ]
    if has_tables(lang.code):
        problems += Russianisms(load_table(lang), lang).find(translation)
    return Reply(translation=translation, problems=problems)


def main() -> None:
    reply = check_chunk(Request.model_validate_json(sys.stdin.read()))
    output = {"translation": reply.translation, "problems": [asdict(p) for p in reply.problems]}
    print(json.dumps(output, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
