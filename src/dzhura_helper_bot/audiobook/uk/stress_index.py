"""Builds the stress index used by prepare.py: every stressed word form of Ukrainian Wiktionary
(kaikki.org extract, CC BY-SA) and the lang-uk list of homographs (words with several stresses).
prepare.py builds it on the first Ukrainian book; to build it again by hand:
uv run python -m dzhura_helper_bot.audiobook.uk.stress_index (downloads ~320 MB, keeps ~18 MB)."""

import csv
import io
import json
import os
import re
from collections import defaultdict

import requests

WIKTIONARY = "https://kaikki.org/dictionary/Ukrainian/kaikki.org-dictionary-Ukrainian.jsonl"
HOMOGRAPHS = "https://raw.githubusercontent.com/lang-uk/ukrainian-tts-preprocessing/dev/lexical_stress_benchmark/data/heteronyms_list.csv"
# (connect, read) seconds: the Wiktionary dump is large and streams slowly.
DOWNLOAD_TIMEOUT = (10, 600)
INDEX = os.path.expanduser("~/.cache/audiobook-bot/stress.json")

STRESS = "́"
WORD = re.compile(rf"^[а-яіїєґ'{STRESS}-]+$")


def normal(word: str) -> str:
    """Lowercase, one kind of apostrophe, no grave accents (Wiktionary marks secondary stress so)."""
    return re.sub("[’ʼ]", "'", word.lower()).replace("̀", "")


def build() -> tuple[int, int]:
    """Downloads the sources and writes the index; (words, homographs)."""
    forms: dict[str, set[str]] = defaultdict(set)
    with requests.get(WIKTIONARY, stream=True, timeout=DOWNLOAD_TIMEOUT) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            for form in json.loads(line).get("forms", []):
                if "romanization" in form.get("tags", []):
                    continue
                for word in re.split(r"[,/ ]+", normal(form["form"])):
                    if STRESS in word and WORD.match(word):
                        forms[word.replace(STRESS, "")].add(word)
    response = requests.get(HOMOGRAPHS, timeout=DOWNLOAD_TIMEOUT)
    response.raise_for_status()
    homographs = sorted({normal(row["Heteronym"]) for row in csv.DictReader(io.StringIO(response.text))})

    os.makedirs(os.path.dirname(INDEX), exist_ok=True)
    with open(f"{INDEX}.part", "w", encoding="utf-8") as f:
        json.dump({"forms": {k: sorted(v) for k, v in forms.items()}, "homographs": homographs}, f, ensure_ascii=False)
    os.replace(f"{INDEX}.part", INDEX)
    return len(forms), len(homographs)


def main() -> None:
    words, homographs = build()
    print(f"{INDEX}: {words} words, {homographs} homographs")


if __name__ == "__main__":
    main()
