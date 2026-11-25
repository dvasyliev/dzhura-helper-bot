# Russianisms

The tables the chunk checker (`../../../scripts/ukrainian/russianisms.py`) flags russianisms and calques by. The check runs only for a target language whose `lang/<code>/` has this folder.

The TSV files are vendored from https://github.com/vladichumachenko/chysto-ukr-skills (path `skills/chysto/data/`), fetched 2026-11-25.

- `lt-replace.tsv`: russianisms and barbarisms from LanguageTool; only rows with level `error` are used.
- `chysto-calques.tsv`: calques of Russian phrases; only rows with level `error` are used.
- `allowed.txt` (ours, not vendored): words and phrases of the tables that are correct Ukrainian on their own and are never flagged, one per line, with a `#` comment giving the reason.
- `settings.json` (ours): `min_word`, the shortest one-word row used; shorter words ("в", "по") depend on context and flag ordinary text.
- `LICENSE`: chysto's MIT licence. `LICENSE-LGPL-2.1.txt` and `NOTICE-languagetool.md`: the licence and origin of the LanguageTool data.
