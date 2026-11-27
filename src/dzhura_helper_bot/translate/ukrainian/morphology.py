"""pymorphy3's dictionary for a language code ("uk") behind a small typed interface: pymorphy3 has no type stubs."""

from functools import cache

import pymorphy3


@cache
def analyzer(code: str) -> pymorphy3.MorphAnalyzer:
    return pymorphy3.MorphAnalyzer(lang=code)


@cache
def forms(word: str, code: str) -> frozenset[str]:
    """All forms of `word` when it is a dictionary form (a noun's nominative, a verb's infinitive), else just `word`.
    Expects lowercase with ' as the apostrophe, as the dictionary has it."""
    found = {word}
    for parse in analyzer(code).parse(word):
        if parse.is_known and parse.normal_form == word:
            found.update(str(form.word) for form in parse.lexeme)
    return frozenset(found)
