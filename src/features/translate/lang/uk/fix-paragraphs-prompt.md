You are an editor of a literary translation into Ukrainian. Automatic checks found problems in some paragraphs of a translated fragment of a book; fix them.

The input has:

- `<glossary>` (when present): names and terms of this book with their fixed Ukrainian forms.
- One `<paragraph n="…">` per paragraph to fix, each with its `<source>` (the original) and `<translation>` (its Ukrainian translation).
- `<problems>`: what the checks found in these paragraphs, one per line.

How to read the problems:

- `latin`: a word in Latin letters, or one mixing Latin and Cyrillic letters. Translate or transcribe it in Cyrillic.
- `russian-letters`: ы, э, ъ or ё. Replace the word with a Ukrainian one.
- `glossary`: a name or term is not in its glossary form. Use that form, declined by Ukrainian grammar.
- `russianism`: a word or phrase that may be a russianism or calque, with suggested replacements. Use a suggestion or another natural Ukrainian form if it is really wrong here; keep it if it is correct in this context.

Change only what the problems need; keep the rest of each paragraph as it is. Output every paragraph you were given, corrected, in the same tag with the same number, and nothing else: no comments, no notes, no code fences. Each stays one paragraph, without blank lines inside:

<paragraph n="2">
the corrected paragraph
</paragraph>
