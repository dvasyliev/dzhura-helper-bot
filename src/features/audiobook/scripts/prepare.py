"""Chapter text ready to voice: abbreviations and numbers in words, stress marks (accentuk; where it
guessed, Wiktionary when it knows a single stress), the book's own stress dictionary on top. Saved to a .txt file, which can be edited by hand before the chapter
is (re)voiced."""

import json
import os
import re
import sys
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
UNSURE_FILE = "unsure.json"  # in the text folder: chapter name → {"unsure": [...], "homographs": [...]}
RULES = os.path.join(os.path.dirname(__file__), "stress_rules.txt")  # for every book
STRESS_INDEX = os.path.expanduser("~/.cache/audiobook-bot/stress.json")  # built by stress_index.py

_accentor = None  # loaded on first use, not needed when the text is already saved
_index = None


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


def same_case(word: str, fixed: str) -> str:
    """`fixed` written the way `word` is: «Йому» → «Йому́», «ЙОМУ» → «ЙОМУ́»."""
    if len(word) > 1 and word.replace(STRESS, "").isupper():
        return fixed.upper()
    return fixed[0].upper() + fixed[1:] if word[0].isupper() else fixed


def load_stress(dictionary: str) -> dict[str, str]:
    """The stress rules for every book with the book's own dictionary on top."""
    return {**load_dictionary(RULES), **load_dictionary(dictionary)}


def apply_dictionary(text: str, dictionary: dict[str, str]) -> str:
    def fix(m: re.Match) -> str:
        fixed = dictionary.get(plain(m[0]))
        return same_case(m[0], fixed) if fixed else m[0]

    return WORD.sub(fix, text)


def stress_index() -> tuple[dict[str, list[str]], set[str]]:
    """Wiktionary stressed forms by plain word, and the lang-uk homograph list."""
    global _index
    if _index is None:
        if os.path.exists(STRESS_INDEX):
            with open(STRESS_INDEX, encoding="utf-8") as f:
                data = json.load(f)
            _index = data["forms"], set(data["homographs"])
        else:
            print(f"{STRESS_INDEX} not found, run stress_index.py; going on without it", file=sys.stderr)
            _index = {}, set()
    return _index


def prepare_text(text: str, dictionary: str) -> tuple[str, list[str], list[str]]:
    """The prepared text, its words with guessed stress, and its homographs (stress chosen by the
    sentence's meaning, worth checking). A guessed word Wiktionary knows with one stress gets that."""
    global _accentor
    if _accentor is None:
        from accentuk import Accentor

        _accentor = Accentor(mode="light")
    source = numbers_to_words(expand_abbreviations(text))
    forms, listed = stress_index()
    parts, unsure, homographs, end = [], [], [], 0
    for token in _accentor.stress(source).tokens:
        word, key = token.output_text, plain(token.text)
        if sum(c in VOWELS for c in token.text) >= 2:
            variants = forms.get(key, [])
            # Wiktionary lists rare variants of common words (йо́го), so only guessed ones count.
            if key in listed or (len(variants) >= 2 and token.status in UNSURE):
                homographs.append(word)
            elif token.status in UNSURE and variants:
                word = same_case(token.text, variants[0])
            elif token.status in UNSURE:
                unsure.append(word)
        parts.append(source[end : token.start] + word)
        end = token.end
    parts.append(source[end:])
    return apply_dictionary("".join(parts), load_stress(dictionary)), unsure, homographs


def prepare_file(text: str, path: str, dictionary: str) -> str:
    """Writes the prepared text to `path` unless it is already there; returns `path`.
    Written under a temporary name first, so a file with the final name is always complete.
    Its unsure words go to unsure.json next to it (one process prepares texts, so no races)."""
    if not os.path.exists(path):
        prepared, unsure, homographs = prepare_text(text, dictionary)
        unsure_path = os.path.join(os.path.dirname(path), UNSURE_FILE)
        words = json.load(open(unsure_path, encoding="utf-8")) if os.path.exists(unsure_path) else {}
        words[os.path.basename(path)] = {"unsure": unsure, "homographs": homographs}
        with open(unsure_path, "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False, indent=1)
        with open(f"{path}.part", "w", encoding="utf-8") as f:
            f.write(prepared)
        os.replace(f"{path}.part", path)
    return path


def write_report(text_dir: str, path: str, dictionary: str) -> int:
    """Words of the book worth checking that are not in the book's dictionary yet, most frequent
    first: guessed stress, then homographs. Returns how many. Creates an empty book dictionary."""
    if not os.path.exists(dictionary):
        with open(dictionary, "w", encoding="utf-8") as f:
            f.write(DICTIONARY_HEADER)
    known = load_stress(dictionary)
    unsure_path = os.path.join(text_dir, UNSURE_FILE)
    chapters = json.load(open(unsure_path, encoding="utf-8")) if os.path.exists(unsure_path) else {}
    # A list is the format before homographs were collected.
    chapters = [c if isinstance(c, dict) else {"unsure": c} for c in chapters.values()]
    guessed = Counter(w.lower() for c in chapters for w in c.get("unsure", []) if plain(w) not in known)
    homographs = Counter(w.lower() for c in chapters for w in c.get("homographs", []) if plain(w) not in known)
    variants: dict[str, list[str]] = {}  # plain word → its chosen stresses, most frequent first
    for word, _ in homographs.most_common():
        variants.setdefault(plain(word), []).append(word)
    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "# Слова, де наголос вгадано: невідоме слово чи ім'я.\n"
            "# Неправильні впишіть у «словник наголосів.txt» поруч, по слову на рядок, з наголосом: Глена́рван\n"
            "# Кожну форму окремо (Глена́рвана, Глена́рваном). Після правки: /regen <номер розділу>.\n\n"
        )
        for word, count in guessed.most_common():
            f.write(f"{word}  ×{count}\n")
        f.write(
            "\n# Омографи: слово має кілька наголосів (за́мок/замо́к), тут — обраний за змістом речення.\n"
            "# Спершу слова, прочитані в книжці по-різному. Словник змінить слово в усій книжці;\n"
            "# щоб виправити одне місце, правте text/<розділ>.txt.\n\n"
        )
        # Words read two ways in the book first: one of the ways is likely wrong.
        for words in sorted(variants.values(), key=lambda ws: (len(ws) < 2, -sum(homographs[w] for w in ws))):
            f.write(" · ".join(f"{w} ×{homographs[w]}" for w in words) + "\n")
    return len(guessed) + len(variants)
