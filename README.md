# Dzhura

A personal Telegram helper bot that runs on your own Mac. A *dzhura* was a Cossack's young helper who carried out any errand; this one turns books into audiobooks and songs into karaoke. It answers only its owner, and all the heavy work runs locally on Apple Silicon: no cloud, no subscriptions.

## Features

| Feature | What you send | What you get | Status |
|---|---|---|---|
| 🎧 Audiobook | an EPUB in Ukrainian or English | an mp3 per chapter, voiced by [HolosTTS](https://huggingface.co/patriotyk/HolosTTS) (Ukrainian) or [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (English) | works |
| 🎤 Karaoke | a YouTube link | a karaoke video with words filling in time, optionally uploaded to your YouTube channel | works |
| 🌐 Book translation | an EPUB | the book in another language | soon |
| 📝 YouTube summary | a YouTube link | a short retelling of the video | soon |

## Ideas

Features that would reuse what is already here (Whisper, vocal separation, HolosTTS, Kokoro, yt-dlp, ffmpeg):

- **Voice message to text**: forward a voice note or video note, get the text and a short summary.
- **Article to audio**: send a link, get an mp3, the same pipeline as audiobooks.
- **Translate and voice a book**: an English EPUB in, a Ukrainian audiobook out.
- **Backing track or a cappella**: music only or vocals only as an mp3, no video.
- **Lyrics with translation**: a foreign song with a Ukrainian line under each sung line.
- **Subtitles for any video**: an `.srt` and a video with burned-in subtitles, optionally translated.

## Quick start

You need a Mac with Apple Silicon and about 6 GB for models.

```bash
brew install node uv
npm install
uv sync
cp .env.example .env   # fill in BOT_TOKEN and OWNER_ID
caffeinate -i npm start
```

The full guide (Telegram bot, stress models, ffmpeg with libass, YouTube upload), by hand or with an agent: [SETUP.md](SETUP.md).

How each feature works inside: [docs/how-it-works.md](docs/how-it-works.md).
