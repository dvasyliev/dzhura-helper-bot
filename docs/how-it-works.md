# How Dzhura works

## Structure

`/start` shows the feature menu. Each feature is its own folder in [src/features/](../src/features/) with its own message and button handlers; the menu list and order are in [src/features/index.ts](../src/features/index.ts). A feature with no handlers shows as "(soon)". Heavy jobs (voicing and so on) run one at a time through [src/jobs.ts](../src/jobs.ts). The Python parts live in the feature's folder: `src/features/<feature>/scripts/` (shared environment: `pyproject.toml` at the root).

| Feature | Status |
|---|---|
| 🎧 Create an audiobook | works |
| 🌐 Translate a book | works |
| 🎤 Generate karaoke | works |
| 📝 YouTube summary | soon |

## How an audiobook is voiced

The bot voices Ukrainian books with HolosTTS and English books with Kokoro. It detects the language from the text: Cyrillic with і/ї/є/ґ is Ukrainian, Latin with many frequent English words (the, and, of…) is English; any other book is refused. The whole book is read by one voice, picked from the buttons with that language's voices. The book's folder is `data/audiobook/<author> - <title>/`; title and author come from the EPUB metadata, or from the file name if there is no title. If the book was voiced before, the bot says right away how many chapters are done in which voice. You can return to a book you already sent without the EPUB: write a word from the title or author ("верн", "гранта") and the bot shows up to 5 matches as buttons (or asks "this one?" if there is one match).

Chapters come from the book's table of contents (one EPUB file can hold several chapters). For each chapter of a Ukrainian book:

1. **Text preparation** ([prepare.py](../src/features/audiobook/scripts/uk/prepare.py)): abbreviations as words ("т. д.", "1864 р.", "XIX ст.", "5 км", "%", "£"), numbers as words ([uk/numbers.py](../src/features/audiobook/scripts/uk/numbers.py)), stress marks ([accentuk](https://pypi.org/project/accentuk/): a dictionary plus a neural network that picks between variants from the sentence's meaning, like за́мок/замо́к; where accentuk guessed and Wiktionary knows a single stress, Wiktionary's is used), then general rules for all books ([stress_rules.txt](../src/features/audiobook/scripts/uk/stress_rules.txt), e.g. коли́ instead of ко́ли) and the book's own stress dictionary (`stresses.txt` in its folder). The result is saved to `text/001 Title.txt`; you can edit it by hand. The texts of the next chapters are prepared in a separate process while the current one is voiced.
2. **Voicing**: phonemes (ipa-uk) → HolosTTS sentence by sentence.

An English chapter is saved to `text/` as written (only "Chapter XII" becomes "Chapter 12"), and [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) reads it through `mlx-audio` ([kokoro.py](../src/features/audiobook/scripts/tts/kokoro.py)); misaki turns it into phonemes, numbers and abbreviations included, with espeak for unknown words such as names. No stress marks, no stress report.

Both models go through the same assembly ([audio.py](../src/features/audiobook/scripts/tts/audio.py)): levelled volume, pauses of 0.35 s between sentences, 0.7 s between paragraphs, 1.2 s after a heading.

Time: HolosTTS ~40 s per 10,000-character chapter (≈13 min of audio), "Діти капітана Гранта" (22 h) takes ≈1 h 5 min; Kokoro ~70 s per 10,000 characters (≈12 min of audio). Before voicing, the bot sends an estimate: duration, size, when the first chapter will arrive and how long the whole book will take.

```
data/audiobook/<author> - <title>/
  <file>.epub
  text/001 Розділ I. Риба-молот.txt        ← prepared text, editable
  audio/<voice>/001 Розділ I. Риба-молот.mp3
  stress-check.txt                    ← words where the stress was guessed
  stresses.txt                    ← your fixes, one word per line, Глена́рван
```

- **Resuming**: a file is first written as `.part` and renamed when done, so an `.mp3` is always complete. If voicing is interrupted, send the book again and pick the same voice: the bot continues from the first unfinished chapter. A chapter that fails twice stops the book so the order isn't broken.
- **Doubtful stresses**: once all texts are ready, the bot sends a list of words where the stress was guessed (an unknown word or a name) and of homographs (за́мок/замо́к; from the [lang-uk](https://github.com/lang-uk/ukrainian-tts-preprocessing) list and Wiktionary), with those read differently within the book first. Add the wrong ones to that book's `stresses.txt`; the next chapters pick them up at once.
- **Re-voicing**: `/regen 5` or `/regen 5-7` re-voices chapters of the last book from `text/*.txt` (including manual edits and the book's dictionary). To prepare a chapter's text from the EPUB again, delete its `.txt`.

Voices are in [voices.json](../src/features/audiobook/voices.json), grouped by language (`uk`, `en`). Each voice has `id`, `name` (the button and the audio folder, so names are unique across languages) and `provider` (`holos` or `kokoro`); every voice of the book's language is a button, in the file's order. Kokoro's language comes from the first letter of the voice id: `a` American, `b` British English.

## How a book is translated

The bot translates en and ru EPUB and PDF books into uk through Claude (`claude -p`, signed in on the Mac). A ru book cannot be voiced, so the bot offers to translate it; an English one gets a "🌐 Translate to Ukrainian" button next to the voices. Code: [src/features/translate/](../src/features/translate/); language data: [lang/](../src/features/translate/lang/).

1. **Glossary candidates** ([glossary_candidates.py](../src/features/translate/scripts/glossary_candidates.py)): names seen at least twice, most frequent first. A language whose `lang/<code>/language.json` names a spaCy model (English: `en_core_web_sm`) uses its named entities; any other, capitalised words in mid-sentence. No ru-specific code or data.
2. **Glossary**: one Claude call gives the Ukrainian title, author and the form of each name with its gender and declension (`glossary.json`).
3. **Translation**: the book is cut into parts by paragraphs; each part goes to Claude with the last paragraph before it and the glossary lines of the names it has (English names match as whole words, names in other languages by their stem).
4. **Check** ([chunk_check.py](../src/features/translate/scripts/chunk_check.py)), without a model: fixes the apostrophe (ʼ), quotes («») and dialogue dashes, then flags Latin words not in the source, ru letters, a lost or extra paragraph, a missing chapter title, glossary names in another form, and calques. A part with problems gets one fix call; the better of the two versions is kept, and what is left goes to `report.json`. If the checker itself fails, the part is saved unchecked and checked again next time; three failures in a row stop the translation.
5. **Book**: the parts are joined into `book.uk.md`, pandoc builds the EPUB, the bot sends it and adds the book to the audiobook library with the voice buttons.

```
data/translate/<author> - <title>/
  book.md                  ← the source as Markdown
  glossary.json            ← names and their Ukrainian forms; edit and translate again to change them
  chunks/0001.md, 0001.uk.md
  report.json              ← parts whose problems were found, fixed or left
  book.uk.md, book.uk.epub
```

- **Resuming**: a part is saved as soon as it is translated. If the translation stops (an error, the bot restarted), "🌐 Translate a book" in the menu lists the unfinished books, and the bot continues from the first part not done. At the Claude usage limit the bot says when it continues and waits.
- **Setup**: `brew install pandoc` (without it the bot adds the book to the library but sends no EPUB); `uv sync` installs spaCy with `en_core_web_sm`, pymorphy3 and its Ukrainian dictionary.
- **Calque tables**: [lang/uk/russianisms/](../src/features/translate/lang/uk/russianisms/) holds tables vendored from [chysto-ukr-skills](https://github.com/vladichumachenko/chysto-ukr-skills) (MIT), which include LanguageTool data (LGPL 2.1); their licences are in that folder. `allowed.txt` there lists the words the checker never flags.

Python tests: `uv run pytest src/features/translate`.

## How karaoke is made

You send a link to a YouTube clip (uk, ru or en), the bot asks which version to make: "🎵 Karaoke" (music only), "🎤 Vocals" (with vocals) or "🎵🎤 Both", and reports which step it is on. [karaoke.py](../src/features/karaoke/scripts/karaoke.py) does it all:

1. **Download** the clip in 720p (`yt-dlp`).
2. **Separate the vocals** from the music (`audio-separator`, ~1 min per new song).
3. **Recognise the singing**: Whisper listens to the vocals for the song's language and a transcript.
4. **Find the lyrics** on [LRCLIB](https://lrclib.net) by artist and title in the same language and compare them with the transcript. If there are no lyrics or they don't match the singing, the bot offers two buttons: "✍️ I'll send the lyrics" (your next multi-line message becomes the lyrics) or "🤖 Use the recognised lyrics" (the bot also sends the recognised text: fix it and send it back, and it remakes the video).
5. **Fit the words to the singing**: align each word with the vocals (`ctc-forced-aligner`).
6. **Build the video**: large outlined text on a slightly dimmed clip, two lines, words filling in time, a 3‑2‑1 countdown before the first line and after long pauses, a marker before each phrase (`ffmpeg` + `libass`).
7. **Upload to YouTube** and send the title with the link (see below).

A song is named like a book: "Artist - Title", or the YouTube video title if those aren't known. Videos are labelled like the buttons: "(Karaoke)" for music only, "(Vocals)" with vocals. A repeated link to the same clip reuses the finished steps, so the second version after the first takes ~40 s.

```
data/karaoke/<artist> - <title>/
  clip.mp4, stems/, meta.json, listen.json, lyrics.json, aligned.json, karaoke.ass
  lyrics.txt                             ← the lyrics you sent; reused next time, editable
  <artist> - <title> (Karaoke).mp4                ← music only
  <artist> - <title> (Vocals).mp4                 ← with vocals
  <...> (HQ).mp4                                  ← full quality, if it had to be compressed for Telegram
```

### YouTube

The bot uploads each finished karaoke in full quality to the channel as unlisted (step 7/7), adds it to the karaoke playlist and sends the title and link to Telegram, without the video itself ([youtube.ts](../src/features/karaoke/youtube.ts)). If the upload fails, the bot says why and sends the video. If the same version of a song is remade, the old copy on YouTube is deleted. Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `YOUTUBE_PLAYLIST_ID` (the playlist) in `.env` (an OAuth client of type "TVs and Limited Input devices" with access to YouTube Data API v3); without them the bot uploads nothing.

The Google app is in "Testing" status, so a sign-in lasts 7 days: when it expires, the bot sends a code for google.com/device. Enter it from any device and the upload continues. The sign-in and the list of uploaded videos are in `data/youtube.json`.

Python tests: `uv run pytest src/features/karaoke`.

## Sample

`npm run sample -- "Жуль Верн - Діти капітана Гранта" 150` takes the EPUB from `data/audiobook/Жуль Верн - Діти капітана Гранта/` and voices the first 150 words in each voice of the book's language into `data/voice-samples/<language>/<voice>.mp3`.

Python tests: `uv run pytest src/features/audiobook`.

## Telegram limits

- EPUB up to 20 MB (the bot can't download a larger file).
- Audio up to 50 MB (≈100 min at 64 kbps): a chapter longer than 90 minutes arrives in parts `001 Title (1)`, `001 Title (2)`.
- Karaoke video up to 50 MB: a long clip is compressed harder; if sending fails, the bot sends the file's path on the Mac.
