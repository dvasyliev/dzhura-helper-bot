# Setting up Dzhura from scratch

What to install and configure so the bot runs on a new Mac. Voicing and karaoke run locally, so you need a Mac with Apple Silicon (M1 or newer).

## Requirements

- A Mac with Apple Silicon (M1 or newer).
- About 10 GB free: ~1 GB of Python libraries, up to ~6 GB of models, plus room for books and videos in `data/`.
- A Telegram account.

What each feature needs on top of that. Install only the rows for the features you want. The models download by themselves on first use, so each feature's first job takes longer.

| Feature | Programs | Accounts | Models |
|---|---|---|---|
| Every feature | Homebrew, Node 24 or newer, uv | a Telegram bot ([step 3](#3-telegram-bot)) | none |
| 🎧 Audiobook | none | none | stress ~450 MB, voices ~700 MB |
| 🌐 Book translation, 📘 PDF → EPUB | pandoc, Claude Code (`claude`; translation only) | a Claude subscription (translation only) | none |
| 🎤 Karaoke | ffmpeg with libass | Google Cloud, only for the [YouTube upload](docs/youtube-upload.md) | ~3.6 GB |
| 📝 YouTube summary | ffmpeg (any build), Claude Code (`claude`) | a Claude subscription | Whisper ~1.5 GB, voices ~700 MB |

You don't have to get this right up front: the bot checks the programs when it starts, marks a feature that lacks one with ⚠️ in its menu, and when you open that feature it says what to install.

## Auto install with an AI agent

Sign in to [web.telegram.org](https://web.telegram.org) in the browser, open the project in Claude Code and paste:

```text
Install and run this Telegram bot (Dzhura) on my Mac by following SETUP.md. Talk to me in plain words, no jargon.

1. First ask me, in one list, which features I want: audiobooks, book translation, PDF → EPUB, karaoke, YouTube summary. Install only the programs those features need, from the Requirements table in SETUP.md.
2. Check that the Mac has Apple Silicon (`uname -m` prints arm64) and about 10 GB free. If not, stop and tell me why.
3. Go through the Manual install steps of SETUP.md in order. After each step, run its check, and don't move on until it passes. Run long commands (the 10–30 min ffmpeg build, `npm run setup`) in the background and tell me how long to wait.
4. Create the Telegram bot with me: I'm signed in to web.telegram.org, so you can use the browser. I type passwords and codes from my phone myself.
5. You can't open `.env`; the project blocks it. Give me the exact lines (`BOT_TOKEN=...`, `OWNER_ID=...`) and I'll paste them in.
6. Start the bot (`npm start`, in the background) and walk me through the check in step 4 of SETUP.md. If a feature in the menu has ⚠️, open it, install what the bot names, and restart the bot.
7. Leave the optional parts (YouTube upload, library group) alone unless I ask. Their guides are docs/youtube-upload.md and docs/library-group.md.

If something fails, show me the exact error and fix it. Don't change the project's code or commit anything; if there's no way around it, ask me first.

At the end, tell me briefly: what works, what was skipped and why, how to stop the bot (Ctrl+C) and how to start it again (`npm start`).
```

The agent runs the commands and stops only where it needs you.

---

## Manual install

Go through the steps in order.

### 1. Programs

Install [Homebrew](https://brew.sh) if you don't have it, then Node.js and `uv` (the Python package manager):

```bash
brew install node uv
```

Check: `node -v` shows version 24 or newer.

Then the programs for the features you want:

- **pandoc** (book translation, PDF → EPUB): `brew install pandoc`.
- **Claude Code** (book translation, YouTube summary): install it by the [official guide](https://docs.claude.com/en/docs/claude-code/setup), then run `claude` once and sign in with your Claude subscription. The bot calls `claude -p` with that sign-in.
- **ffmpeg** (YouTube summary): `brew install ffmpeg`.
- **ffmpeg with libass** (karaoke; it covers the summary too). The plain `brew install ffmpeg` lacks libass, the library that draws the lyrics on the video, so karaoke needs this build:

  ```bash
  brew uninstall ffmpeg   # only if the plain one is installed
  brew tap homebrew-ffmpeg/ffmpeg
  brew install homebrew-ffmpeg/ffmpeg/ffmpeg
  ```

  It compiles on your Mac, which takes 10–30 minutes, and every `brew upgrade` that updates it compiles it again. Check: `ffmpeg -hide_banner -filters | grep -w ass` prints a line.

### 2. Code

```bash
git clone https://github.com/dvasyliev/dzhura-helper-bot.git
cd dzhura-helper-bot
npm run setup
```

`npm run setup` installs the Node packages (`npm install`, which also turns on the git hooks in `.githooks/`), Python 3.12 with its libraries in `.venv` (`uv sync`, about 1 GB) and creates `.env` from `.env.example`. You can run it again at any time; it keeps your `.env`.

`.env` holds your secrets. It is not in git; don't delete it or share it.

### 3. Telegram bot

#### 3.1. Create the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Enter the name you'll see in the chat, for example `Dzhura`.
4. Enter the bot's username in Latin letters, ending in `bot`, for example `my_dzhura_helper_bot`.
5. BotFather sends a token like `1234567890:AA...`. Copy it.

Later, in @BotFather you can change the name (`/setname`), the description and the picture (`/setdescription`, `/setuserpic`). The username (`@..._bot`) can't be changed; you can only create a new bot.

#### 3.2. Find your Telegram ID

1. Open [@userinfobot](https://t.me/userinfobot).
2. Send it anything. It replies with a number: `Id: 123456789`.

The bot answers only this ID and ignores everyone else.

#### 3.3. Fill in `.env`

```env
BOT_TOKEN=1234567890:AA...
OWNER_ID=123456789
```

The bot won't start without these two variables.

### 4. Run and check

```bash
npm start
```

It keeps the Mac awake while the bot runs (`caffeinate`). Stop it with `Ctrl+C`. `npm start` first stops a bot already running from this folder, so it also restarts the bot, for example after you install a missing program.

Check in Telegram:

1. `/start` shows the feature menu. A feature marked ⚠️ lacks a program: open it to see which.
2. Audiobook: send a Ukrainian or English EPUB; the bot shows an estimate and the voice buttons of its language.
3. Karaoke: send a YouTube music clip link; the bot asks which version to make.
4. YouTube summary: send a link to any other YouTube video; the bot describes it.

## Optional

- [YouTube upload for karaoke](docs/youtube-upload.md): karaoke goes to your channel as unlisted videos instead of files in Telegram.
- [Library group](docs/library-group.md): everything the bot makes goes to a Telegram group with a topic per book.

---

## Reference

### Voices

The voice buttons are in [voices.json](src/lib/tts/voices.json), grouped by language. Each voice has `id`, `name` (the audio folder; the button shows the voice's gender and language, «👩 Woman (UA)»), `gender` and `provider` (`holos` for Ukrainian, `kokoro` for English). Every voice of the book's language becomes a button, so keep one woman and one man per language. Kokoro's other English voices are in its [voice list](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md): an id starting with `a` is American, with `b` British.

To hear the voices, put an EPUB into `data/books/<Author> - <Title>/` and run `npm run sample -- "<Author> - <Title>" 150`: `data/voice-samples/<language>/` gets an mp3 of the first 150 words in each voice of the book's language.

### When YouTube downloads stop working

`yt-dlp` breaks now and then when YouTube changes something. Update it:

```bash
uv lock --upgrade-package yt-dlp --upgrade-package yt-dlp-ejs && uv sync
```

### Full `.env`

```env
# Telegram (required)
BOT_TOKEN=
OWNER_ID=

# YouTube upload for karaoke (optional, docs/youtube-upload.md)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_PLAYLIST_ID=
```

### Where things live

| What | Where |
|---|---|
| Books, audio, karaoke, summaries | `data/` in the project |
| YouTube sign-in | `data/youtube.json` |
| Library group (ids of the group, topics and messages) | `data/library.json` |
| Python libraries | `.venv/` in the project |
| Voice models, Whisper | `~/.cache/huggingface/hub` |
| Stress model | `~/.cache/accentuk` |
| Wiktionary stress data | `~/.cache/audiobook-bot/stress.json` |
