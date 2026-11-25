# Dzhura

A personal Telegram helper bot that runs on your own Mac. A *dzhura* was a Cossack's young helper who carried out any errand; this one turns books into audiobooks and songs into karaoke. It answers only its owner, and voicing and karaoke run locally on Apple Silicon.

## Features

| Feature | Description | Languages | Implementation | Status |
|---|---|---|---|---|
| 🎧 Audiobook | Voices EPUB and text PDF books and sends them to Telegram as an mp3 per chapter. | EN/UA | HolosTTS (UA), Kokoro-82M (EN), docling (PDF) | works |
| 🎤 Karaoke | Makes karaoke videos from YouTube songs, with the words lighting up as they are sung, and sends them to Telegram or to your personal YouTube playlist. | EN/UA/RU | Mel-Band RoFormer, Whisper, MMS | works |
| 🌐 Book translation | Translates EPUB and PDF books and sends the translated book to Telegram. | EN/RU → UA | Claude, pandoc | soon |
| 📝 YouTube summary | Retells a YouTube video in a few paragraphs and sends the summary to Telegram. | EN/UA/RU | — | soon |

Voicing and karaoke models run locally on Apple Silicon; translation goes through Claude.

## How it works

### 🎧 Audiobook

The bot first gets plain text out of the book. An EPUB is unpacked with [JSZip](https://github.com/Stuk/jszip) and its chapters are read with [node-html-parser](https://github.com/taoqf/node-html-parser). A PDF is checked with [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) to make sure it has a text layer and is not a scan, and then [docling](https://github.com/docling-project/docling) turns it into Markdown once, so later loads read chapters straight from that file.

Before a Ukrainian book is voiced, its text is prepared so the model reads it correctly: [num2words](https://github.com/savoirfairelinux/num2words) spells out the numbers, [accentuk](https://pypi.org/project/accentuk/) places the stresses, and [ipa-uk](https://github.com/patriotyk/ipa-uk) turns the words into phonemes. [HolosTTS](https://huggingface.co/patriotyk/HolosTTS) then reads them through [holos-tts-mlx](https://pypi.org/project/holos-tts-mlx/). An English book needs less preparation: [misaki](https://github.com/hexgrad/misaki) turns the text into phonemes, and [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) reads it through [mlx-audio](https://github.com/Blaizzy/mlx-audio).

In both cases [lameenc](https://github.com/chrisstaite/lameenc) saves each chapter as an mp3, which the bot sends to Telegram as soon as it is ready.

### 🎤 Karaoke

[yt-dlp](https://github.com/yt-dlp/yt-dlp) downloads the clip, and [Mel-Band RoFormer](https://github.com/nomadkaraoke/python-audio-separator), run through [audio-separator](https://github.com/nomadkaraoke/python-audio-separator), splits the singer's voice from the music.

The bot then needs the words and the moment each one is sung. [Whisper large-v3-turbo](https://huggingface.co/mlx-community/whisper-large-v3-turbo), run through [mlx-whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper), listens to the voice and recognises the song's language and words. The bot looks up the real lyrics on [LRCLIB](https://lrclib.net) and compares them with what Whisper heard. Once the lyrics are settled, [ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner) with the MMS model matches each word to the moment it is sung.

Finally the video is put together. If the singing starts right away, [librosa](https://github.com/librosa/librosa) finds the song's beat so the bot can add a short count-in. [Pillow](https://github.com/python-pillow/Pillow) measures the subtitle lines so they fit on screen, and [ffmpeg](https://ffmpeg.org) with libass burns them into the video. The bot sends the result to Telegram, or uploads it to your playlist through the [YouTube Data API](https://developers.google.com/youtube/v3).

### 🌐 Book translation (soon)

The book will be translated from the same Markdown the bot already makes for PDFs. [Claude](https://www.anthropic.com/claude), called through `claude -p`, will translate it, and [pandoc](https://pandoc.org) will build the translated EPUB from the result.

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

<!-- COURSES:START -->
## My Educational Courses

I teach developers what I use in production: practical, project-based courses on AI coding tools, Agentic AI, Vibe Coding and modern full-stack technologies. Every course builds on projects I ship and workflows I test first. Students learn what holds up in real work, from new framework releases to AI coding tools.

👨‍🎓 Taught **235,000+ students** across Udemy and Coursera, with a **4.4+ average rating**.<br/>
📚 Created **25+ courses** across AI coding, frontend, full-stack and modern developer tools.

#### AI Coding Courses

<p>
  <a href="https://go.dvasyliev.com/harness-engineering"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/harness-engineering.png" width="150" alt="Claude Code Harness Engineering: Make AI Agents Reliable" title="Make AI agents check their own work"/></a>
  <a href="https://go.dvasyliev.com/evaluating-ai-code"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/evaluating-ai-code.png" width="150" alt="AI Code Review: Evaluate Python Code with Confidence" title="Review AI-written Python code"/></a>
  <a href="https://go.dvasyliev.com/cca-f"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/cca-f.png" width="150" alt="Claude Certified Architect CCAR-F Exam Prep: Real AI Project" title="Exam prep with a real project"/></a>
  <a href="https://go.dvasyliev.com/openclaw"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/openclaw.png" width="150" alt="OpenClaw for Developers: AI Coding Crash Course" title="Your own AI agent on a VPS"/></a>
  <a href="https://go.dvasyliev.com/claude-code"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/claude-code.png" width="150" alt="Claude Code Crash Course: AI Coding for Developers" title="AI agent for features, fixes and tests"/></a>
  <a href="https://go.dvasyliev.com/v0"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/v0.png" width="150" alt="Vibe Coding for Developers: v0 AI, Supabase, Vercel Deploy" title="Vibe coding with v0 and Supabase"/></a>
  <a href="https://go.dvasyliev.com/gh300"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/gh300.png" width="150" alt="GH-300: Github Copilot – Complete Exam Preparation Guide" title="Complete GH-300 exam preparation"/></a>
  <a href="https://go.dvasyliev.com/lovable"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/lovable.png" width="150" alt="Lovable AI: Complete Guide for Vibe Coding" title="Launch AI-powered apps with Lovable"/></a>
  <a href="https://go.dvasyliev.com/cursor"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/cursor.png" width="150" alt="Cursor AI for Beginners: AI Coding Crash Course" title="Cursor AI for vibe coding"/></a>
  <a href="https://go.dvasyliev.com/copilot"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/copilot.png" width="150" alt="GitHub Copilot for Beginners: AI Coding Crash Course" title="Step-by-step Copilot for developers"/></a>
</p>

#### Web Development Courses

<p>
  <a href="https://go.dvasyliev.com/nodejs"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/nodejs.png" width="150" alt="Node.js Crash Course: Build a REST API in a Weekend" title="REST API with Node.js in a weekend"/></a>
  <a href="https://go.dvasyliev.com/nextjs"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/nextjs.png" width="150" alt="Next.js Crash Course: Build a Full-Stack App in a Weekend" title="Full-stack Next.js in a weekend"/></a>
  <a href="https://go.dvasyliev.com/ai-chatbot"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/ai-chatbot.png" width="150" alt="React.js AI Chatbot built with ChatGPT, Gemini AI and DeepSeek" title="ChatGPT, Gemini and DeepSeek chatbot"/></a>
  <a href="https://go.dvasyliev.com/react"><img src="https://raw.githubusercontent.com/dvasyliev/dvasyliev/main/courses/react.png" width="150" alt="React Crash Course: From Zero to Hero" title="Build your first React app"/></a>
</p>

[See more courses →](https://www.dvasyliev.com/courses)
<!-- COURSES:END -->

## Contributing

Have a question, found a bug or have an idea? [Open an issue](https://github.com/dvasyliev/dzhura-helper-bot/issues). Pull requests are welcome. Commit rules and how the code is laid out: [CLAUDE.md](CLAUDE.md). What changed in each version: [CHANGELOG.md](CHANGELOG.md) and [Releases](https://github.com/dvasyliev/dzhura-helper-bot/releases). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Dmytro Vasyliev
