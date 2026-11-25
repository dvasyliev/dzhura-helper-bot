# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal Telegram bot (grammY, TypeScript on Node via `tsx`) that answers only its owner and runs on an Apple Silicon Mac. Features: voicing a Ukrainian EPUB into an audiobook (HolosTTS, local) and making karaoke videos from a YouTube link (vocal separation, lyrics, word alignment, ffmpeg subtitles). The heavy work is in Python (uv, `pyproject.toml` at the root); the bot calls it as a subprocess.

## Architecture

- Each feature is a folder in `src/features/<feature>/` with its own message and button handlers; the menu order is in `src/features/index.ts`. A feature with no handlers shows as "(скоро)".
- Heavy jobs run one at a time through `src/jobs.ts`.
- Python code lives next to its feature in `src/features/<feature>/scripts/`. The TS side starts it with `spawn("uv", ["run", "--quiet", "python", "<script>"])` and talks over stdin/stdout. Scripts import their neighbours by bare module name (`import lyrics`), so each `scripts/` folder is its own import root. Its subfolders are packages imported from that root (`from uk.prepare import ...`).
- Working data (books, audio, videos) goes to `data/` (git-ignored). Secrets are in `.env` (`BOT_TOKEN`, `OWNER_ID`).
- Specs go to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, plans to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`.
