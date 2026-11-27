"""Typography fixes made without a model: the language's apostrophe, quotes and dialogue dash."""

import re

from dzhura_helper_bot.translate.language import Language, in_script

PARAGRAPH_BREAK = re.compile(r"(\n\s*\n)")
# Before an opening quote: the start of the text, a space, an opening bracket, or the language's dialogue dashes.
OPENS_AFTER = " \t\n([{"


def fix_apostrophes(text: str, lang: Language) -> str:
    """Puts the language's apostrophe in place of its variants between two letters of its script."""

    def between_letters(match: re.Match[str]) -> str:
        start, end = match.start(), match.end()
        inside = start > 0 and end < len(text)
        if inside and in_script(text[start - 1], lang.script) and in_script(text[end], lang.script):
            return lang.apostrophe
        return match.group()

    return re.sub(f"[{re.escape(lang.apostrophe_variants)}]", between_letters, text)


def quote_pairs(paragraph: str, lang: Language) -> list[tuple[int, int, int]] | None:
    """The straight quotes of a paragraph as (open, close, depth) pairs, depth counting the language's
    quotes around them; None when the straight quotes do not pair up."""
    pairs: list[tuple[int, int, int]] = []
    stack: list[int] = []
    outer = 0
    for i, char in enumerate(paragraph):
        if char == lang.quotes[0]:
            outer += 1
        elif char == lang.quotes[1]:
            outer = max(0, outer - 1)
        elif char == '"' and (
            i == 0 or paragraph[i - 1] in OPENS_AFTER + lang.dialogue_dash + lang.dialogue_dash_variants
        ):
            stack.append(i)
        elif char == '"':
            if not stack:
                return None
            start = stack.pop()
            pairs.append((start, i, outer + len(stack)))
    return None if stack else pairs


def fix_paragraph_quotes(paragraph: str, lang: Language) -> str:
    pairs = quote_pairs(paragraph, lang)
    if not pairs:
        return paragraph
    chars = list(paragraph)
    for start, end, depth in pairs:
        if any(in_script(char, lang.script) for char in paragraph[start + 1 : end]):
            chars[start], chars[end] = lang.quotes if depth == 0 else lang.inner_quotes
    return "".join(chars)


def fix_quotes(text: str, lang: Language) -> str:
    """Straight double quotes around text in the language's script become its quotes; nested ones its inner quotes."""
    return "".join(fix_paragraph_quotes(part, lang) for part in PARAGRAPH_BREAK.split(text))


def fix_dialogue(text: str, lang: Language) -> str:
    """A paragraph opening with a hyphen or dash and a space (a dialogue line) opens with the dialogue dash."""
    variants = re.escape(lang.dialogue_dash_variants)
    return re.sub(f"(^|\\n\\s*\\n)(\\s*)[{variants}] ", f"\\1\\2{lang.dialogue_dash} ", text)


def fix_typography(text: str, lang: Language) -> str:
    return fix_dialogue(fix_quotes(fix_apostrophes(text, lang), lang), lang)
