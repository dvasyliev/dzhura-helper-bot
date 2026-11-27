# How Dzhura works

## Structure

`/start` shows the feature menu: audiobook, translation, PDF to EPUB, karaoke and YouTube summary. Each feature is its own folder in [src/features/](../src/features/) with its own message and button handlers; the menu list and order are in [src/features/index.ts](../src/features/index.ts). A feature with no handlers shows as "(soon)". A sent book or link goes through [src/lib/input/input.ts](../src/lib/input/input.ts) first: the bot reads it once, asks every feature for its actions (`actions` in the feature), and replies with one card of buttons ([src/card.ts](../src/card.ts)); when only one feature can help and its next step is a question or a job (a Ukrainian book's voices, the karaoke version of a music clip, the summary of any other YouTube video), that comes at once. YouTube links are split by category: a video YouTube files under Music gets karaoke, any other video gets the summary; if the bot cannot read the video, it offers both. Heavy jobs run one at a time through [src/lib/jobs/jobs.ts](../src/lib/jobs/jobs.ts). Code shared by features is in [src/lib/](../src/lib/) (books, the Claude runner, voices, the library group, video info and so on). The Python code is one package, [src/dzhura_helper_bot/](../src/dzhura_helper_bot/), with a subpackage per unit (shared environment: `pyproject.toml` at the root); its tests are in `tests/<unit>/`. The features and their status are in the [README](../README.md#features).

## The book card

The card has the book's cover as a photo and, as its caption, the title, author, `Language · N chapters · year · ~N pages` and a short Ukrainian description (without a cover, the same as text). The info is computed once per book and saved in the book's folder: `info.json` (year, pages, description) and `cover.jpg` or `cover.png`. The cover is the EPUB's own image if it has one, else the PDF's first upright picture on its first three pages ([pdf_cover.py](../src/dzhura_helper_bot/book/pdf_cover.py)), else [Open Library](https://openlibrary.org); a book saved without a cover is looked for again on its next card or `/publish`, keeping the rest; year and pages come from Open Library (pages are estimated from the text, ≈1800 characters a page, when it doesn't know the book); the description is written by Claude from the title, author and the start of the text ([description-prompt.md](../src/lib/book/description-prompt.md)). The card waits up to 30 s for this; if it takes longer, or a part fails, the card goes out without that part, and the work goes on in the background and shows on the next card. A translation shows its original's cover, year and pages with its own description, and its EPUB gets the cover. Code: [src/features/book/info.ts](../src/lib/book/info.ts).

## How an audiobook is voiced

The bot voices Ukrainian books with HolosTTS and English books with Kokoro. It detects the language from the text: Cyrillic with і/ї/є/ґ is Ukrainian, Latin with many frequent English words (the, and, of…) is English; any other book is refused. A book is an EPUB or a PDF with a text layer (a scan is refused); a PDF is converted once into `book.md` with docling, and its chapters come from its bookmarks or headings. The whole book is read by one voice, picked from the buttons with that language's voices. The book's folder is `data/books/<author> - <title>/`; title and author come from the book's metadata, or from the file name if there is no title. If the book was voiced before, the bot says right away how many chapters are done in which voice. You can return to a book you already sent without the EPUB: write a word from the title or author ("верн", "гранта") and the bot shows up to 5 matches as buttons (or asks "this one?" if there is one match).

An EPUB's chapters come from its table of contents (one EPUB file can hold several chapters). Chapters keep their levels where the book has them (a nested EPUB table of contents, PDF bookmark levels; `book.md` writes them as `#`, `##`, `###`). Tracks follow the top-level chapters: each is one track however long, with all its sections; what comes before the first one (about the book, introduction) is one track, and so is the back matter (afterword, acknowledgements, about the author, copyright, notes). When the list is flat, top-level chapters are guessed from titles («Chapter 2», «Part 3», «Розділ XII», «Частина друга», «1. Title» in a run 1, 2, 3…). When none is found, short chapters are joined up to 7500 characters (≈10 min of audio; a longer chapter is a track of its own). A joined chapter's title is read as a heading line before its text, and everything in the bot (numbers, `/regen N`, file names) counts tracks, still called chapters. A track is named after its first chapter ([tracks.ts](../src/lib/book/tracks.ts)). For each chapter of a Ukrainian book:

1. **Text preparation** ([prepare.py](../src/dzhura_helper_bot/audiobook/uk/prepare.py)): abbreviations as words ("т. д.", "1864 р.", "XIX ст.", "5 км", "%", "£"), numbers as words ([uk/numbers.py](../src/dzhura_helper_bot/audiobook/uk/numbers.py)), stress marks ([accentuk](https://pypi.org/project/accentuk/): a dictionary plus a neural network that picks between variants from the sentence's meaning, like за́мок/замо́к; where accentuk guessed and Wiktionary knows a single stress, Wiktionary's is used), then general rules for all books ([stress_rules.txt](../src/dzhura_helper_bot/audiobook/uk/stress_rules.txt), e.g. коли́ instead of ко́ли) and the book's own stress dictionary (`stresses.txt` in its folder). The result is saved to `text/001 Title.txt`; you can edit it by hand. The texts of the next chapters are prepared in a separate process while the current one is voiced.
2. **Voicing**: phonemes (ipa-uk) → HolosTTS sentence by sentence.

An English chapter is saved to `text/` as written (only "Chapter XII" becomes "Chapter 12"), and [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) reads it through `mlx-audio` ([kokoro.py](../src/dzhura_helper_bot/audiobook/tts/kokoro.py)); misaki turns it into phonemes, numbers and abbreviations included, with espeak for unknown words such as names. No stress marks, no stress report.

Both models go through the same assembly ([audio.py](../src/dzhura_helper_bot/audiobook/tts/audio.py)): levelled volume, pauses of 0.35 s between sentences, 0.7 s between paragraphs, 1.2 s after a heading.

Time: HolosTTS ~40 s per 10,000-character chapter (≈13 min of audio), "Діти капітана Гранта" (22 h) takes ≈1 h 5 min; Kokoro ~70 s per 10,000 characters (≈12 min of audio). Before voicing, the bot sends an estimate: duration, size, when the first chapter will arrive and how long the whole book will take.

```
data/books/<author> - <title>/
  <file>.epub
  text/001 Розділ I. Риба-молот.txt        ← prepared text, editable
  audio/<voice>/001 Розділ I. Риба-молот.mp3
  stress-check.txt                    ← words where the stress was guessed
  stresses.txt                    ← your fixes, one word per line, Глена́рван
  translation/                    ← its Ukrainian translation, laid out the same way (see below)
```

- **Resuming**: a file is first written as `.part` and renamed when done, so an `.mp3` is always complete. If voicing is interrupted, send the book again and pick the same voice: the bot continues from the first unfinished chapter. A chapter that fails twice stops the book so the order isn't broken.
- **Doubtful stresses**: once all texts are ready, the bot sends a list of words where the stress was guessed (an unknown word or a name) and of homographs (за́мок/замо́к; from the [lang-uk](https://github.com/lang-uk/ukrainian-tts-preprocessing) list and Wiktionary), with those read differently within the book first. Add the wrong ones to that book's `stresses.txt`; the next chapters pick them up at once.
- **Audio**: no grouping: each track is its own message (not an album), so it can be reacted to and forwarded alone. Its Telegram title is `001. <the chapter title as written in the book>` (a later file of a long chapter adds ` (2)`), and its caption is the chapter title with `⏱ 20 min` on the next line, the time estimated from the text ([captions.ts](../src/lib/book/audio-caption.ts)). The book's own parts (a track whose first line is `Частина друга`, `PART II`, `Книга третя` starts one, up to the next) get a message before their first audio, `📖 Частина друга` with `⏱ 6 h 21 min` on the next line, the part's whole time; a book without parts is just its audio. A changed caption is edited in place; a message sent again keeps its file by file id. In the library topic each audio has the book's cover as its album art: `thumb.jpg` next to the cover, at most 320 px, made with macOS `sips` ([thumbnail.ts](../src/lib/library/thumbnail.ts)); Telegram takes a thumbnail only with an uploaded file, so audio posted before gets uploaded again once. Voicing sends each track once it is voiced.
- **Re-voicing**: `/regen 5` or `/regen 5-7` re-voices chapters of the last book from `text/*.txt` (including manual edits and the book's dictionary). To prepare a chapter's text from the EPUB again, delete its `.txt`.

Voices are in [voices.json](../src/lib/tts/voices.json), grouped by language (`uk`, `en`). Each voice has `id`, `name` (the button and the audio folder, so names are unique across languages), `provider` (`holos` or `kokoro`), `gender` and, for the voices that read summaries, `summaryTempo`; every voice of the book's language is a button, in the file's order. Kokoro's language comes from the first letter of the voice id: `a` American, `b` British English.

## How a book is translated

The bot translates en and ru EPUB and PDF books into uk through Claude (`claude -p`, signed in on the Mac). A sent en or ru book gets a "🌐 Translate to Ukrainian" button on its card (a ru one cannot be voiced, so that is its only button). Code: [src/features/translate/](../src/features/translate/); language data: [lang/](../src/features/translate/lang/).

1. **Glossary candidates** ([glossary_candidates.py](../src/dzhura_helper_bot/translate/glossary_candidates.py)): names seen at least twice, most frequent first. A language whose `lang/<code>/language.json` names a spaCy model (English: `en_core_web_sm`) uses its named entities; any other, capitalised words in mid-sentence. No ru-specific code or data.
2. **Glossary**: one Claude call gives the Ukrainian title, author and the form of each name with its gender and declension (`glossary.json`).
3. **Translation**: the book is cut into parts by paragraphs; each part goes to Claude with the last paragraph before it and the glossary lines of the names it has (English names match as whole words, names in other languages by their stem).
4. **Check** ([chunk_check.py](../src/dzhura_helper_bot/translate/chunk_check.py)), without a model: fixes the apostrophe (ʼ), quotes («») and dialogue dashes, then flags Latin words not in the source, ru letters, a lost or extra paragraph, a missing chapter title, glossary names in another form, and calques. A part with problems gets a fix call, and a second one if Latin or ru letters are still left; the version with fewer problems is kept, and what is left goes to `report.json`. If the checker itself fails, the part is saved unchecked and checked again next time; three failures in a row stop the translation.
5. **Book**: the parts are joined into `translation/book.md`, pandoc builds the EPUB, the bot sends it and offers the voice buttons. The translation is a book of its own: search finds it as «<original> · 🌐 Ukrainian», and its voices go to `translation/audio/<voice>/`.

```
data/books/<author> - <title>/translation/
  source.md                ← the source as Markdown
  glossary.json            ← names and their Ukrainian forms; edit and translate again to change them
  chunks/0001 <chapter title>.md, .uk.md  ← «(1)», «(2)» after a chapter cut into several
  report.json              ← parts whose problems were found, fixed or left
  usage.json               ← Claude's calls, tokens and cost for the book
  book.md, book.epub       ← the translation
  text/, audio/<voice>/    ← once it is voiced
```

- **Resuming**: a part is saved as soon as it is translated. If the translation stops (an error, the bot restarted), "🌐 Translate a book" in the menu lists the unfinished books, and the bot continues from the first part not done. At the Claude usage limit the bot says when it continues and waits.
- **Setup**: `brew install pandoc` (without it the bot adds the book to the library but sends no EPUB); `uv sync` installs spaCy with `en_core_web_sm`, pymorphy3 and its Ukrainian dictionary.
- **Calque tables**: [lang/uk/russianisms/](../src/features/translate/lang/uk/russianisms/) holds tables vendored from [chysto-ukr-skills](https://github.com/vladichumachenko/chysto-ukr-skills) (MIT), which include LanguageTool data (LGPL 2.1); their licences are in that folder. `allowed.txt` there lists the words the checker never flags.

Python tests: `uv run pytest tests/translate`.

## PDF to EPUB

Send a PDF book (a text PDF, read into `book.md` as for the audiobook) and press "📘 Make EPUB" on its card; the button shows only for a PDF whose `book.epub` is not made yet. pandoc builds `book.epub` from `book.md` with the book's language and cover (without pandoc the bot says "The EPUB needs pandoc (`brew install pandoc`)"). The result goes to the book's topic in the library group, or to the private chat without one. Code: [src/features/epub/index.ts](../src/features/epub/index.ts).

## How karaoke is made

You send a link to a YouTube music clip (uk, ru or en), the bot asks "❓ Which version?" with a time forecast: "🎵 Karaoke" (music only), "🎤 Vocals" (with vocals) or "🎵🎤 Both". One status message shows the step it is on, like `3/7 · Recognising the singing · ≈2 min left`; without YouTube set up there are 6 steps, with no upload. [karaoke.py](../src/dzhura_helper_bot/karaoke/karaoke.py) does it all:

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
  clip.mp4, stems/, meta.json, listen.json, lyrics.json, aligned.json, countin.json, karaoke.ass
  lyrics.txt                             ← the lyrics you sent; reused next time, editable
  <artist> - <title> (Karaoke).mp4                ← music only
  <artist> - <title> (Vocals).mp4                 ← with vocals
  <...> (HQ).mp4                                  ← full quality, if it had to be compressed for Telegram
```

### YouTube

The bot uploads each finished karaoke in full quality to the channel as unlisted (step 7/7), adds it to the karaoke playlist and sends the title and link to Telegram, without the video itself ([youtube.ts](../src/features/karaoke/youtube.ts)). If the upload fails, the bot says why and sends the video. If the same version of a song is remade, the old copy on YouTube is deleted. Needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `YOUTUBE_PLAYLIST_ID` (the playlist) in `.env` (an OAuth client of type "TVs and Limited Input devices" with access to YouTube Data API v3); without them the bot uploads nothing.

`yt-dlp` solves YouTube's page checks with Node, which the bot already runs on (the `yt-dlp-ejs` solver; options in [shared/youtube.py](../src/dzhura_helper_bot/shared/youtube.py)), so no deno is needed.

The Google app is in "Testing" status, so a sign-in lasts 7 days: when it expires, the bot sends a code for google.com/device. Enter it from any device and the upload continues. The sign-in and the list of uploaded videos are in `data/youtube.json`.

Python tests: `uv run pytest tests/karaoke`.

## How a YouTube video is summarised

You send a YouTube link that is not a music clip. The bot makes a short description at once: two paragraphs (what the video is, what the author says; under 700 characters) in Ukrainian, written by Claude (`claude -p`, prompts in [src/features/summary/](../src/features/summary/)). The description is the video's card: with a library group it goes to the `Summary` topic (title, link, YouTube's cover as the link preview, the text), without one it comes to the private chat. The card has the buttons "📝 Summary" and, once a summary exists, "🎧 Audio".

1. **Transcript** ([transcript.py](../src/dzhura_helper_bot/summary/transcript.py)): the subtitles made by people, in the video's language when there is a track (YouTube's automatic subtitles are never used); otherwise the audio is downloaded and Whisper (`mlx-community/whisper-large-v3-turbo`) listens, and the status says "No subtitles, listening to the video…". The text is saved as `transcript.txt`, one line per about 30 seconds: `[m:ss] text`.
2. **Summary**: Claude gets the title, channel, the author's chapters and the transcript. "📝 Summary" opens a menu: "Brief" (the main ideas, grouped by topic) and "Detailed" (every idea unfolded, with a contents list and times that link to that moment of the video). A video in English also offers English versions: "Brief (UA)", "Brief (EN)", "Detailed (UA)", "Detailed (EN)". The menu hides the version already shown.
3. **Audio**: "🎧 Audio" offers the voices of the shown summary's language, "👩 Woman" and "👨 Man" (Oksana and Andrii; Heart and George for English). The text is cleaned for reading (no links, times or contents list) and voiced by the same TTS as the audiobooks, but faster: the voice's `summaryTempo` in [voices.json](../src/lib/tts/voices.json) (1.15 for the Ukrainian voices, 1 for the English ones), as one file however long it is. A version or voice already on disk is shown at once; the rest is made in the background.

Below the card are two slots, one for the summary file and one for the audio; each is a text placeholder until its file comes, and the file takes its message's place. Switching the version keeps every other version on disk; the slots show one version at a time (`shown.json`), and if audio was shown, the new version is voiced again with a voice of the same gender. A button pressed while a slot is being made answers "Already working on it". At the Claude usage limit the job stops and says when the limit resets.

```
data/summary/<channel> - <title>/
  meta.json             ← the video's info and its YouTube id (the folder is found by the id)
  transcript.txt
  about.md              ← the description in the card
  brief.md, detailed.md ← Ukrainian summaries; English: brief.en.md, detailed.en.md
  brief - Andrii.mp3    ← audio: <level> - <Voice>.mp3
  shown.json            ← the version and voice the slots show
  speech/               ← the text the voice read, and its dictionary
```

Code: [src/features/summary/](../src/features/summary/) (buttons and jobs), [src/lib/library/summary.ts](../src/lib/library/summary.ts) (folders, menus, the topic), [src/lib/video/](../src/lib/video/) (link, info, message text). Python tests: `uv run pytest tests/summary`.

## The library group

Results go to a Telegram group instead of the private chat. The private chat stays the control panel (buttons, progress, questions, the stress report); when something lands in the group, the job's Done message links to it (see [Status messages](#status-messages)). Code: [src/lib/library/](../src/lib/library/) (the sync); [src/features/library/](../src/features/library/) is the `/publish` command (a folder with no menu item).

The group is a forum (Topics on) that only the bot writes in. It mirrors `data/`: after each job the bot compares the files on disk with the messages it posted and makes the topic match.

- `/publish` goes topic by topic: for a book it first makes the info (cover, year, pages, description) if it has none yet, as its card would, then syncs. One status message, edited at most every 3 s, has a header `📚 Publishing the library · 3/10 topics` and a line per topic (`⏳ Title` waiting, `🔄 34/90 | Title` messages sent or edited, `✅ 23 updated | Title` or `✅ no changes | Title`), and ends as `✅ Library is up to date · N topics` or `⚠️ Publishing stopped` ([progress.ts](../src/lib/library/progress.ts)). The rows are each book, "Karaoke" and "Summaries".
- **One topic per book**, named `Author — Title`, with a pinned contents message (the book's cover with the same card as in the chat: language, chapters, year, pages, a short description, how many chapters are voiced in which voice, whether a translation exists), the original file, the Ukrainian EPUB if translated, then for each voice a `🎧 <voice>` header and its tracks, each its own message with its caption, a book part's message before its first track. While a book is voiced, each chapter is posted once it is voiced. A translated book stays in its original's topic.
- **One topic `🎤 Karaoke`**: a pinned contents message (`🎤 Karaoke · N songs`, each song with links to its Karaoke and Vocals), then three messages per song: a header (the song's name and the original clip's link), Karaoke and Vocals. A version not made yet is a text placeholder with a "🎤 Make it" button; when the video is ready it replaces the placeholder in the same place. A version uploaded to YouTube is its link.
- **One topic `Summary`**: a pinned contents message (`📝 Summary · N videos`, each title linked to its card), then per video its card (description, cover preview, buttons "📝 Summary" / "🎧 Audio"), a summary slot (the `.md` document) and an audio slot. See [the summary](#how-a-youtube-video-is-summarised).
- **Changes** (a re-voiced chapter, a new translation) replace the file in its message. If a chapter is missing in the middle, the messages from there are deleted and sent again (files already in Telegram are re-sent by `file_id`, not uploaded twice).
- **Limits**: a file over 50 MB is skipped and its path is sent to the private chat once. Telegram allows about 20 messages a minute in a group, so a long book takes a few minutes; the bot waits when Telegram says "slow down".
- **State** is in `data/library.json` (group id, topic and message ids, each file's `file_id`, size and time). The group id is saved by itself when you add the bot; no environment variable is needed.
- **`/publish`** puts everything already in `data/` into the group; run it again and it adds only what is missing.
- **Fallback**: with no group, or if the group breaks (bot removed, rights lost), files come to the private chat as before and the bot says why, once. A topic deleted by hand comes back with /publish (which checks every topic still exists) or when a sync next sends to it. A single message deleted by hand is replaced when its file changes, or when a later change makes the bot send the messages after it again.

Setup: [library-group.md](library-group.md).

Tests: `npx vitest run src/features/library src/lib/library`.

## Status messages

Every job reports in the owner's chat in one format, `<status>: <what> - <title>` ([status.ts](../src/lib/text/status.ts)): "⏳ Processing", "✅ Done" or "⚠️ Failed", and what is made, with its language in brackets: "Audiobook (UA)", "Book Translation (UA)", "Karaoke Music (EN)", "Brief Summary (UA)", "Book EPUB". The title links to the result once it exists. A running job edits its message and shows how far it is with a counter: "3/40 chapters", "3/80 parts", "3/7 steps", then "≈2 min left". A failed job shows the error under its line.

The Done message ends with what the job spent. A job that called Claude (a summary, a translation) shows tokens, the price at API prices (what it would cost without the subscription), the model and the time:

```
🪙 12K in · 1.2K out 💵 ≈$0.12
🤖 Sonnet 4.5 ⏱ 1 min
```

Voicing, karaoke, EPUB and summary audio show the time alone (`⏱ 7 min`). Each Claude call is saved in `data/ai-usage.json` and counted in a pinned month total, `📊 AI in <Month>`, edited after each call; a new month gets a new one ([ai-usage.ts](../src/lib/claude/ai-usage.ts)). A book's description is the one Claude call that still sends its own usage message, `📚 Book description · <title>`.

## Sample

`npm run sample -- "Жуль Верн - Діти капітана Гранта" 150` takes the EPUB from `data/books/Жуль Верн - Діти капітана Гранта/` and voices the first 150 words in each voice of the book's language into `data/voice-samples/<language>/<voice>.mp3`.

Python tests: `uv run pytest tests/audiobook`.

## Telegram limits

- A book file (EPUB, PDF) up to 20 MB (the bot can't download a larger file).
- Audio up to 50 MB (≈100 min at 64 kbps): a chapter longer than 90 minutes arrives in parts `001 Title (1)`, `001 Title (2)`.
- Karaoke video up to 50 MB: a long clip is compressed harder; if sending fails, the bot sends the file's path on the Mac.
- A summary message is cut to Telegram's 4096 characters.
