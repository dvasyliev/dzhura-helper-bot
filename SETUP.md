# Setting up Dzhura from scratch

A step-by-step guide to what to install and configure so the bot runs on a new Mac. You need a Mac with Apple Silicon (M1 or newer): voicing and karaoke run locally.

## Two ways

**By hand.** Go through the sections below in order.

**With an agent (Claude Code).** Open the project in Claude Code and write:

> Set up the project following SETUP.md. Use the browser for Google Cloud and Telegram.

The agent runs the terminal commands and sets up Google Cloud and Telegram in the browser. It stops only where it needs you.

Before you start, sign in in the browser to:
- **Google** ([console.cloud.google.com](https://console.cloud.google.com)) with the account that owns your YouTube channel;
- **Telegram** ([web.telegram.org](https://web.telegram.org)).

The agent does not type passwords or codes from your phone, and it cannot open `.env`: the project blocks it, since the file holds your secrets. These steps are yours:
- create `.env` (`cp .env.example .env`) and paste in the values the agent gives you (step 2.3, 5.4, 5.5);
- the checkbox agreeing to Google's policy in Google Cloud (step 5.3);
- the first YouTube sign-in with a code at google.com/device (step 5.6);
- **Continue** on the "app isn't verified" warning during that sign-in.

## Order

1. [General](#1-general): tools and code.
2. [Telegram bot](#2-telegram-bot): token and your ID.
3. [Audiobook](#3-audiobook): Python, stress and voice models.
4. [Karaoke](#4-karaoke): ffmpeg, deno, models.
5. [YouTube](#5-youtube-for-karaoke): Google Cloud, OAuth, playlist.
6. [Library group](#6-library-group-optional): a Telegram group with a topic per book.
7. [Run and check](#7-run-and-check).

Disk space: about 6 GB for models, plus room for books and videos in `data/`.

---

## 1. General

Install [Homebrew](https://brew.sh) if you don't have it, then Node.js and `uv` (the Python package manager):

```bash
brew install node uv
```

Check: `node -v` shows version 22 or newer, and `uv --version` prints something.

Get the code and install the Node dependencies:

```bash
git clone https://github.com/dvasyliev/dzhura-helper-bot.git
cd dzhura-helper-bot
npm install
cp .env.example .env
```

`npm install` also turns on the git hooks in `.githooks/`.

`.env` holds your secrets. It is not in git; don't delete it or share it.

---

## 2. Telegram bot

### 2.1. Create the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Enter the name you'll see in the chat, for example `Dzhura`.
4. Enter the bot's username in Latin letters, ending in `bot`, for example `my_dzhura_helper_bot`.
5. BotFather sends a token like `1234567890:AA...`. Copy it.

Later, in @BotFather you can change:
- the name: `/setname`;
- the description and picture: `/setdescription`, `/setuserpic`.

The username (`@..._bot`) can't be changed; you can only create a new bot.

### 2.2. Find your Telegram ID

1. Open [@userinfobot](https://t.me/userinfobot).
2. Send it anything. It replies with a number: `Id: 123456789`.

The bot answers only this ID and ignores everyone else.

### 2.3. Fill in `.env`

```env
BOT_TOKEN=1234567890:AA...
OWNER_ID=123456789
```

The bot won't start without these two variables.

---

## 3. Audiobook

Voicing runs locally through MLX. A Ukrainian book: Python prepares the text (numbers as words, stress marks), and the [HolosTTS](https://huggingface.co/patriotyk/HolosTTS) model speaks it. An English book: the [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) model reads the text as written (it reads numbers and abbreviations itself).

### 3.1. Python dependencies

```bash
uv sync
```

`uv` installs Python 3.12 and all libraries into `.venv` (about 1 GB). This folder is the Python version of `node_modules`. If you delete it, `uv` recreates it, but downloads the ~1 GB again.

What gets installed for the audiobook (from [pyproject.toml](pyproject.toml)):
- `holos-tts-mlx`: the Ukrainian voice model;
- `ipa-uk`: turns Ukrainian text into phonemes, installed from GitHub;
- `mlx-audio`: runs the English voice model Kokoro;
- `misaki[en]` and `en-core-web-sm`: turn English text into phonemes (with a built-in espeak for unknown words such as names);
- `accentuk`: stress marks (a dictionary plus a neural network);
- `num2words`: numbers as words;
- `lameenc`: mp3 encoding.

### 3.2. Stress models (Ukrainian)

Once, after `uv sync`:

```bash
uv run accentuk download --light
uv run python src/features/audiobook/scripts/uk/stress_index.py
```

- The first command downloads the stress model (~375 MB) into `~/.cache/accentuk`.
- The second downloads stress data from Wiktionary (~320 MB) and keeps 18 MB of it in `~/.cache/audiobook-bot/stress.json`.

### 3.3. Voice models

Nothing to do. HolosTTS (a few hundred MB) and Kokoro (`mlx-community/Kokoro-82M-bf16`, ~350 MB) download from Hugging Face on the first voicing in their language into `~/.cache/huggingface/hub`, so the first book starts with a delay.

### 3.4. Voices

The voice buttons are in [voices.json](src/features/audiobook/voices.json), grouped by language. Each voice has `id`, `name` (the button) and `provider` (`holos` for Ukrainian, `kokoro` for English). Every voice of the book's language becomes a button. Kokoro's other English voices are in its [voice list](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md): an id starting with `a` is American, with `b` British.

### 3.5. Check

Put an EPUB into `data/books/<Author> - <Title>/` and voice a sample:

```bash
npm run sample -- "<Author> - <Title>" 150
```

`data/voice-samples/<language>/` (`uk` or `en`) gets an mp3 of the first 150 words in each voice of the book's language.

---

## 4. Karaoke

Karaoke also runs locally: download the clip, separate the vocals, recognise the singing, find the lyrics, align the words, build the video.

### 4.1. ffmpeg with libass, and deno

```bash
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg deno
```

- **ffmpeg** puts the lyrics on the video. It must be this build: the plain `brew install ffmpeg` lacks `libass`, the library that draws subtitles. If the plain ffmpeg is already installed, run `brew uninstall ffmpeg` first.
- This build compiles on your Mac, which takes 10–30 minutes. Every `brew upgrade` rebuilds it too.
- **deno** is needed by `yt-dlp` to read YouTube pages. Without it, YouTube downloads may stop working.

Check that libass is there:

```bash
ffmpeg -hide_banner -filters | grep -w ass
```

It should print a line with `ass`.

### 4.2. Python dependencies

Already installed by `uv sync` in step 3.1:
- `yt-dlp`: downloads the clip;
- `audio-separator`: separates vocals from music (Mel-Band RoFormer model);
- `audioread`: needed by `audio-separator`, which doesn't install it itself, so it's listed separately;
- `mlx-whisper`: detects the language and transcribes the song;
- `ctc-forced-aligner`: aligns each word to the singing. Installed from GitHub, because the PyPI package with that name is someone else's and knows only English letters;
- `pillow`: measures line width so the text fits the frame.

`yt-dlp` breaks now and then when YouTube changes something. Then update it:

```bash
uv lock --upgrade-package yt-dlp && uv sync
```

### 4.3. Models

They download on the first karaoke:
- vocal separation ~900 MB;
- word alignment ~1.2 GB;
- Whisper ~1.5 GB.

So the first karaoke takes longer.

### 4.4. Lyrics

The bot takes lyrics from [LRCLIB](https://lrclib.net). No key needed. If there are no lyrics, the bot offers to let you send them yourself or to use the recognised text.

Karaoke already works without step 5: the bot sends the video straight to Telegram (up to 50 MB).

---

## 5. YouTube (for karaoke)

The bot uploads each finished karaoke to your channel as unlisted, adds it to a playlist and sends you the link in Telegram. This is optional: without `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `YOUTUBE_PLAYLIST_ID` the bot uploads nothing and sends the video itself to Telegram. `YOUTUBE_PLAYLIST_ID` is the switch: keep the Google keys in `.env` and leave the playlist empty to get videos in Telegram again.

It's all free. The API quota covers about 100 uploads a day.

### 5.1. Google Cloud project

Sign in with the Google account that owns your YouTube channel.

1. Open [console.cloud.google.com](https://console.cloud.google.com).
2. Top left, pick the project selector → **New project**. Any name, for example `Dzhura`. **Create**.
3. Make sure this project is selected at the top.

### 5.2. Enable YouTube Data API v3

1. Menu → **APIs & Services** → **Library**.
2. Find **YouTube Data API v3** → **Enable**.

### 5.3. OAuth consent screen

This is the screen Google shows when you let the bot access your channel.

1. Menu → **APIs & Services** → **OAuth consent screen** (or **Google Auth Platform**) → **Get started**.
2. **App name**: `Dzhura`. **User support email**: your email. **Next**.
3. **Audience**: **External**. **Next**.
4. **Contact information**: your email. **Next**.
5. Tick "I agree to the Google API Services: User Data Policy" → **Continue** → **Create**.
6. **Audience** section → **Test users** → **Add users** → add the email of the account with the YouTube channel → **Save**.

The app stays in **Testing**. Don't publish it. As a result, a sign-in lasts 7 days, then the bot asks you to sign in again (see 5.6).

### 5.4. OAuth client

1. **Clients** section (or **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**).
2. **Application type**: **TVs and Limited Input devices**. It must be this type: it lets you sign in with a code from another device, with no browser on the Mac.
3. Any name, for example `Dzhura bot`. **Create**.
4. Copy the **Client ID** and **Client secret** into `.env`:

```env
GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

### 5.5. Playlist

The bot puts every karaoke into one playlist.

1. Create a playlist on YouTube (unlisted or private is fine).
2. Open it. The playlist ID is in the address after `list=`, for example `PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
3. Put it into `.env`:

```env
YOUTUBE_PLAYLIST_ID=PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 5.6. First sign-in

Nothing to run. On the first upload the bot sends you in Telegram:

> To upload to YouTube, sign in: open google.com/device, enter the code from the next message and pick the account with the channel.

The next message is the code, like `ABCD-EFGH`.

1. On any device, open [google.com/device](https://www.google.com/device).
2. Enter the code.
3. Pick the account with the channel.
4. Google warns that the app isn't verified. Press **Continue**: it's your own app.
5. Allow access to YouTube.

The code is valid for ~30 minutes; the bot waits and then continues the upload by itself. The sign-in is saved in `data/youtube.json`. Every 7 days the bot will send a new code; that's normal for Testing status.

### 5.7. About copyright

YouTube checks unlisted videos for other people's music too. A Content ID claim isn't a strike and doesn't hurt the channel: at worst the song's owner blocks the video or mutes it. Don't dispute such claims, and there will be no strike.

---

## 6. Library group (optional)

The bot can post everything it makes into a Telegram group: a topic per book and one for karaoke (what it looks like: [README](README.md#library-group)). Without a group, files come to the private chat. No `.env` value is needed: the bot saves the group by itself.

1. In Telegram, create a group and turn on **Topics** in its settings.
2. Add the bot to the group.
3. Make the bot an admin with **Manage topics**, **Delete messages** and **Pin messages**.
4. The bot replies in the private chat that the group is saved, or which rights it still lacks.
5. Send `/publish` in the private chat: the bot posts everything already in `data/`. Later results go to the group by themselves.

To share the library, invite people to the group. To keep it tidy, turn off **Send messages** for members in the group's **Permissions**: they can still listen and download. The bot follows only your commands and button presses, even in the group.

---

## 7. Run and check

```bash
caffeinate -i npm start
```

`caffeinate` keeps the Mac awake while the bot runs. Stop it with `Ctrl+C`. `npm start` first stops a bot already running from this folder, so it also restarts the bot.

Check in Telegram:
1. `/start` shows the feature menu.
2. Audiobook: send a Ukrainian or English EPUB; the bot shows an estimate and the voice buttons of its language.
3. Karaoke: send a YouTube clip link; the bot asks which version to make.
4. YouTube: after a karaoke, the bot sends a sign-in code (the first time), then the video link.
5. Library group: after a job, the bot replies `Done → <link>` and the file is in the group's topic.

### Full `.env`

```env
# Telegram (required)
BOT_TOKEN=
OWNER_ID=

# YouTube for karaoke (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_PLAYLIST_ID=
```

### Where things live

| What | Where |
|---|---|
| Books, audio, karaoke | `data/` in the project |
| YouTube sign-in | `data/youtube.json` |
| Library group (ids of the group, topics and messages) | `data/library.json` |
| Python libraries | `.venv/` in the project |
| Voice model, Whisper | `~/.cache/huggingface/hub` |
| Stress model | `~/.cache/accentuk` |
| Wiktionary stress data | `~/.cache/audiobook-bot/stress.json` |
