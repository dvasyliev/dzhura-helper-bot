"""Expands abbreviations and unit signs into words, before numbers are spelled out."""

import re

from dzhura_helper_bot.audiobook.uk.numbers import ROMAN, ordinal, roman

FIXED = {
    "і т. д.": "і так далі",
    "т. д.": "так далі",
    "т. п.": "тому подібне",
    "т. ін.": "таке інше",
    "та ін.": "та інші",
    "до н. е.": "до нашої ери",
    "н. е.": "нашої ери",
    "напр.": "наприклад",
    "див.": "дивись",
    "Прим. ред.": "Примітка редакції",
    "прим. ред.": "примітка редакції",
}
# Unit after a number → its forms for 1, 2–4 and 5+ («1 кілометр», «2 кілометри», «5 кілометрів»).
UNITS = {
    "км": ("кілометр", "кілометри", "кілометрів"),
    "см": ("сантиметр", "сантиметри", "сантиметрів"),
    "мм": ("міліметр", "міліметри", "міліметрів"),
    "м": ("метр", "метри", "метрів"),
    "кг": ("кілограм", "кілограми", "кілограмів"),
    "%": ("відсоток", "відсотки", "відсотків"),
    "°": ("градус", "градуси", "градусів"),
    "тис.": ("тисяча", "тисячі", "тисяч"),
    "млн": ("мільйон", "мільйони", "мільйонів"),
    "млрд": ("мільярд", "мільярди", "мільярдів"),
}
# Currency sign before a number.
CURRENCIES = {
    "£": ("фунт", "фунти", "фунтів"),
    "$": ("долар", "долари", "доларів"),
    "€": ("євро", "євро", "євро"),
}


def plural(n: int, forms: tuple[str, str, str]) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return forms[0]
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return forms[1]
    return forms[2]


def expand_abbreviations(text: str) -> str:
    for short, full in FIXED.items():
        pattern = re.escape(short).replace(r"\ ", r"\s?")  # «т. д.» and «т.д.»
        text = re.sub(r"(?<!\w)" + pattern, full, text)

    units = "|".join(re.escape(u) for u in sorted(UNITS, key=len, reverse=True))
    text = re.sub(rf"\b(\d+)\s?({units})(?![\w'’ʼ])", lambda m: f"{m[1]} {plural(int(m[1]), UNITS[m[2]])}", text)
    text = re.sub(r"([£$€])\s?(\d+)\b", lambda m: f"{m[2]} {plural(int(m[2]), CURRENCIES[m[1]])}", text)
    text = re.sub(r"№\s?(\d+)", r"номер \1", text)

    # «у 1864 р.» → «у 1864 році», «26 липня 1864 р.» → «26 липня 1864 року».
    text = re.sub(r"(?<!\w)([уУвВ]\s+)(\d+)\s?р\.", r"\1\2 році", text)
    text = re.sub(r"\b(\d+)\s?р\.", r"\1 року", text)
    text = re.sub(r"\b(\d+)\s?рр\.", r"\1 років", text)

    # «у XIX ст.» → «у дев'ятнадцятому столітті», «кінця XIX ст.» → «кінця дев'ятнадцятого століття».
    def century(m: re.Match) -> str:
        n = roman(m[2]) if m[2][0] in ROMAN else int(m[2])
        return f"{m[1]}{ordinal(n, 'loc')} столітті" if m[1] else f"{ordinal(n, 'gen')} століття"

    return re.sub(r"(?<!\w)([уУвВ]\s+)?\b([IVXLC]+|\d+)\s?(?:ст\.|столітт[яі])", century, text)
