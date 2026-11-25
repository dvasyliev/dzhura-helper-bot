"""Chapter text ready to voice: abbreviations and numbers in words, stress marks, the book's own
stress dictionary on top. Saved to a .txt file, which can be edited by hand before the chapter
is (re)voiced."""

import json
import os
import re
from collections import Counter

from abbreviations import expand_abbreviations
from numbers_uk import numbers_to_words

STRESS = "́"
DICTIONARY_HEADER = """# Словник наголосів цієї книжки: по слову на рядок, з наголосом, напр. Глена́рван
# Має перевагу над автоматичними наголосами. Кожну форму пишіть окремо: Глена́рвана, Глена́рваном.
# Кандидати — у «сумнівні наголоси.txt». Готові розділи переозвучте: /regen <номер>.
"""
VOWELS = set("аеєиіїоуюяАЕЄИІЇОУЮЯ")
# Letters, each maybe with a stress mark after it; apostrophes and hyphens only between letters.
WORD = re.compile(rf"(?:[^\W\d_]{STRESS}?)+(?:[-'’ʼ](?:[^\W\d_]{STRESS}?)+)*")

# accentuk statuses for words whose stress was guessed: picked the usual of several variants,
# derived from the ending (names), placed by default, or not found at all.
UNSURE = {"dictionary_default", "suffix", "default_position", "not_found"}
UNSURE_FILE = "unsure.json"  # in the text folder: chapter name → its unsure words

_accentor = None  # loaded on first use, not needed when the text is already saved


def plain(word: str) -> str:
    """Lookup key: no stress marks, lowercase, one kind of apostrophe."""
    return re.sub("[’ʼ]", "'", word.replace(STRESS, "")).lower()


def load_dictionary(path: str) -> dict[str, str]:
    """One stressed word per line («Глена́рван»), # starts a comment."""
    if not os.path.exists(path):
        return {}
    words = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            word = line.split("#")[0].strip()
            if word:
                words[plain(word)] = word
    return words


def apply_dictionary(text: str, dictionary: dict[str, str]) -> str:
    def fix(m: re.Match) -> str:
        word, fixed = m[0], dictionary.get(plain(m[0]))
        if not fixed:
            return word
        if len(word) > 1 and word.replace(STRESS, "").isupper():
            return fixed.upper()
        return fixed[0].upper() + fixed[1:] if word[0].isupper() else fixed

    return WORD.sub(fix, text)


def prepare_text(text: str, dictionary: str) -> tuple[str, list[str]]:
    """The prepared text and its words with guessed stress."""
    global _accentor
    if _accentor is None:
        from accentuk import Accentor

        _accentor = Accentor(mode="light")
    result = _accentor.stress(numbers_to_words(expand_abbreviations(text)))
    unsure = [t.output_text for t in result.tokens if t.status in UNSURE and sum(c in VOWELS for c in t.text) >= 2]
    return apply_dictionary(result.text, load_dictionary(dictionary)), unsure


def prepare_file(text: str, path: str, dictionary: str) -> str:
    """Writes the prepared text to `path` unless it is already there; returns `path`.
    Written under a temporary name first, so a file with the final name is always complete.
    Its unsure words go to unsure.json next to it (one process prepares texts, so no races)."""
    if not os.path.exists(path):
        prepared, unsure = prepare_text(text, dictionary)
        unsure_path = os.path.join(os.path.dirname(path), UNSURE_FILE)
        words = json.load(open(unsure_path, encoding="utf-8")) if os.path.exists(unsure_path) else {}
        words[os.path.basename(path)] = unsure
        with open(unsure_path, "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False, indent=1)
        with open(f"{path}.part", "w", encoding="utf-8") as f:
            f.write(prepared)
        os.replace(f"{path}.part", path)
    return path


def write_report(text_dir: str, path: str, dictionary: str) -> int:
    """Words of the book with guessed stress that are not in the book's dictionary yet, most
    frequent first. Returns how many. Creates an empty book dictionary, ready to be filled."""
    if not os.path.exists(dictionary):
        with open(dictionary, "w", encoding="utf-8") as f:
            f.write(DICTIONARY_HEADER)
    known = load_dictionary(dictionary)
    unsure_path = os.path.join(text_dir, UNSURE_FILE)
    chapters = json.load(open(unsure_path, encoding="utf-8")) if os.path.exists(unsure_path) else {}
    words = [w for chapter in chapters.values() for w in chapter if plain(w) not in known]
    guessed = Counter(plain(w) for w in words)
    shown = {plain(w): w.lower() for w in words}  # «Її́» and «її́» are one word
    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "# Слова, де наголос вгадано: невідоме слово, ім'я або обрано типовий з кількох варіантів.\n"
            "# Неправильні впишіть у «словник наголосів.txt» поруч, по слову на рядок, з наголосом: Глена́рван\n"
            "# Кожну форму окремо (Глена́рвана, Глена́рваном). Після правки: /regen <номер розділу>.\n\n"
        )
        for key, count in guessed.most_common():
            f.write(f"{shown[key]}  ×{count}\n")
    return len(guessed)
