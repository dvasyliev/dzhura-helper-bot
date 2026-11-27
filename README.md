# Dzhura

<p align="center">
  <img src="assets/repo-banner.svg" alt="Dzhura: a Telegram bot that sums up YouTube videos, translates and voices books, and makes karaoke" width="100%">
</p>

<p>
  <a href="https://github.com/dvasyliev/dzhura-helper-bot/actions/workflows/ci.yml"><img src="https://github.com/dvasyliev/dzhura-helper-bot/actions/workflows/ci.yml/badge.svg" alt="CI" height="20"></a>
  <a href="https://github.com/dvasyliev/dzhura-helper-bot/releases/latest"><img src="https://img.shields.io/github/v/release/dvasyliev/dzhura-helper-bot?label=release&amp;color=4A5BD4" alt="Latest release" height="20"></a>
  <a href="https://core.telegram.org/bots"><img src="https://img.shields.io/badge/Telegram-26A5E4?logo=telegram&amp;logoColor=white" alt="Telegram bot" height="20"></a>
  <a href="https://github.com/dvasyliev/claude-plugins/tree/main/plugins/codebase-harness"><img src="assets/badges/codebase-harness.svg" alt="Built with the codebase-harness plugin" height="20"></a>
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Claude_Code-D97757?logo=claude&amp;logoColor=white" alt="Claude Code" height="20"></a>
  <a href="#features"><img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&amp;logoColor=white" alt="TypeScript" height="20"></a>
  <a href="#features"><img src="https://img.shields.io/badge/Node-5FA04E?logo=nodedotjs&amp;logoColor=white" alt="Node" height="20"></a>
  <a href="#features"><img src="https://img.shields.io/badge/Python-3776AB?logo=python&amp;logoColor=white" alt="Python" height="20"></a>
  <a href="#quick-start"><img src="assets/badges/apple-silicon.svg" alt="Runs on Apple Silicon" height="20"></a>
  <a href="https://huggingface.co/patriotyk/HolosTTS"><img src="https://img.shields.io/badge/UA_voice-HolosTTS-3B6EA5" alt="Ukrainian voice: HolosTTS" height="20"></a>
  <a href="https://huggingface.co/hexgrad/Kokoro-82M"><img src="https://img.shields.io/badge/EN_voice-Kokoro--82M-8E6BB8" alt="English voice: Kokoro-82M" height="20"></a>
  <a href="https://huggingface.co/mlx-community/whisper-large-v3-turbo"><img src="https://img.shields.io/badge/transcription-Whisper-3D8B7D" alt="Transcription: Whisper" height="20"></a>
  <a href="https://github.com/nomadkaraoke/python-audio-separator"><img src="https://img.shields.io/badge/karaoke-Mel--Band_RoFormer-C0604A" alt="Karaoke vocal split: Mel-Band RoFormer" height="20"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-DFB317" alt="MIT license" height="20"></a>
</p>

<p>
  <a href="#features"><b>Features</b></a>
  &nbsp;&nbsp;&nbsp;
  <a href="#quick-start"><b>Quick start</b></a>
  &nbsp;&nbsp;&nbsp;
  <a href="#contributing"><b>Contributing</b></a>
</p>

A personal Telegram bot that runs on your own Mac. It sums up YouTube videos, translates and voices books, and makes karaoke from songs. It answers only its owner.

## Features

### 📝 YouTube video → Summary → Voice-over

Send a link to a YouTube video and get a summary in Ukrainian (and in English for an English video), brief or detailed, with times that link to that moment of the video. Then have it voiced: a woman's or a man's voice reads it to you.

### 📚 Book → Translation → Audiobook

Send an EPUB or PDF book. Translate it into Ukrainian from English or Russian, then voice the translation as an audiobook, an mp3 per chapter. A Ukrainian or English book can be voiced right away, and a text PDF can be turned into an EPUB.

### 🎤 YouTube song → Karaoke

Send a link to a YouTube song and get a karaoke video with the words lighting up as they are sung: music only, with the singer's vocals, or both. Works for English, Ukrainian and Russian songs.

### Where it runs

Voicing and karaoke run locally on Apple Silicon; translation and summaries go through Claude. Results can also go to a Telegram group of your own, a topic per book: [docs/library-group.md](docs/library-group.md). How each feature works inside: [docs/how-it-works.md](docs/how-it-works.md).

## Quick start

You need a Mac with Apple Silicon and about 6 GB for models.

```bash
brew install node uv
npm run setup   # Node and Python packages, and .env from .env.example
# fill in BOT_TOKEN and OWNER_ID in .env
npm start
```

That is enough for audiobooks. The other features need a program or two each (pandoc, ffmpeg, Claude Code); the bot marks the ones it lacks in its menu. Full guide: [SETUP.md](SETUP.md).

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

The [calque tables](src/features/translate/lang/uk/russianisms/) are vendored from [chysto-ukr-skills](https://github.com/vladichumachenko/chysto-ukr-skills) (MIT) and include LanguageTool data (LGPL 2.1); their licences are in that folder.
