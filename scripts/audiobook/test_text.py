"""Run: cd scripts/audiobook && uv run python test_text.py"""

from fish import to_fish_text
from sentences import MAX_SENTENCE_CHARS, pack, split_sentences

assert split_sentences("Перше речення. Друге!  Третє?") == ["Перше речення.", "Друге!", "Третє?"]
assert split_sentences(" – … ") == [], "pieces with no letters are dropped"

long = ", ".join(["слово " * 10] * 10)
pieces = split_sentences(long)
assert all(len(p) <= MAX_SENTENCE_CHARS for p in pieces), [len(p) for p in pieces]
assert " ".join(pieces).split() == long.split(), "no words lost"

assert pack(["аа.", "бб.", "вв."], 7) == ["аа. бб.", "вв."]
assert pack(["задовге речення"], 5) == ["задовге речення"], "a piece longer than the limit stays whole"

assert to_fish_text("Две́рі ма́ли") == "ДвЭрі мАлы", "stressed vowel uppercase, и/е → ы/э"
assert to_fish_text("Їжак і щей, Glenarvan") == "Їжак і щэй, Glenarvan", "й, ї and Latin untouched"
print("ok")
