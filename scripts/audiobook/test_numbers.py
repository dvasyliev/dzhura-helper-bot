"""Run: cd scripts/audiobook && uv run python test_numbers.py"""

from numbers_uk import numbers_to_words

cases = {
    "26 липня 1864 року": "двадцять шостого липня тисяча вісімсот шістдесят четвертого року",
    "У 1812 році було 300 солдатів.": "У тисяча вісімсот дванадцятому році було триста солдатів.",
    "1991 рік": "тисяча дев'ятсот дев'яносто перший рік",
    "3 березня": "третього березня",
    "пройшла 15 миль": "пройшла п'ятнадцять миль",
    "Розділ I. Риба": "Розділ перший. Риба",
    "Частина III": "Частина третя",
    "Глава XII": "Глава дванадцята",
    "Розділ 2": "Розділ другий",
    "Я і ти": "Я і ти",
}

failed = 0
for given, expected in cases.items():
    got = numbers_to_words(given)
    if got != expected:
        failed += 1
        print(f"FAIL {given!r}\n  got      {got!r}\n  expected {expected!r}")
print(f"{len(cases) - failed}/{len(cases)} passed")
raise SystemExit(1 if failed else 0)
