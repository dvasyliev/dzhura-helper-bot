"""Run: cd src/features/audiobook/scripts && uv run python test_text.py"""

import os
import tempfile

from abbreviations import expand_abbreviations
from fish import to_fish_text
from prepare import apply_dictionary, load_dictionary, prepare_text
from sentences import MAX_SENTENCE_CHARS, pack, split_sentences
from voice import save

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
abbreviations = {
    "26 липня 1864 р. вони": "26 липня 1864 року вони",
    "у 1864 р. вони": "у 1864 році вони",
    "на початку XIX ст.": "на початку дев'ятнадцятого століття",
    "у XIX ст.": "у дев'ятнадцятому столітті",
    "21 км, 3 км і 5 км": "21 кілометр, 3 кілометри і 5 кілометрів",
    "12 % і 2%": "12 відсотків і 2 відсотки",
    "£5 і $1": "5 фунтів і 1 долар",
    "каюта № 6": "каюта номер 6",
    "столи, стільці і т. д. Далі": "столи, стільці і так далі Далі",
    "моря тощо – Прим. ред.": "моря тощо – Примітка редакції",
    "Том мав 5 метрів": "Том мав 5 метрів",
    "3 м’ячі": "3 м’ячі",
}
for given, expected in abbreviations.items():
    assert expand_abbreviations(given) == expected, (given, expand_abbreviations(given))

with tempfile.TemporaryDirectory() as d:
    with open(f"{d}/stress.txt", "w") as f:
        f.write("# names\nГленарва́н\nїї́  # pronoun\n")
    words = load_dictionary(f"{d}/stress.txt")
    assert apply_dictionary("Гле́нарван і ГЛЕНАРВАН, а́ її", words) == "Гленарва́н і ГЛЕНАРВА́Н, а́ її́"
    assert apply_dictionary("п’ять Гленарвана", words) == "п’ять Гленарвана", "other forms untouched"

    assert save([b"a"], d, "001 Розділ") == [f"{d}/001 Розділ.mp3"]
    assert save([b"a", b"b"], d, "002 Розділ") == [f"{d}/002 Розділ (1).mp3", f"{d}/002 Розділ (2).mp3"]
    assert not [n for n in os.listdir(d) if n.endswith(".part")]
    with open(f"{d}/book.txt", "w") as f:
        f.write("майорі́в\n")
    text, unsure, homographs = prepare_text("Його книжка була тут.\nУ 1864 р. майорів прапор. Йому дали замок, коли почув.", f"{d}/book.txt")
    assert text.startswith("Його́ кни́жка була́ "), text
    assert "майорі́в" in text, "book dictionary wins over the model"
    assert "ти́сяча вісімсо́т" in text, "numbers in words"
    assert "Йому́" in text, "Wiktionary fixes a guessed stress"
    assert "коли́ почу́в" in text, "stress rules for every book"
    assert "замо́к" in homographs or "за́мок" in homographs, homographs
print("ok")
