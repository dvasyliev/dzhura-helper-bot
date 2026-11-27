# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal Telegram bot (grammY, TypeScript on Node via `tsx`) that answers only its owner and runs on an Apple Silicon Mac. Features: voicing a Ukrainian EPUB into an audiobook (HolosTTS, local) and making karaoke videos from a YouTube link (vocal separation, lyrics, word alignment, ffmpeg subtitles). The heavy work is in Python (uv, `pyproject.toml` at the root); the bot calls it as a subprocess.

## Architecture

- Each feature is a folder in `src/features/<feature>/` with its own message and button handlers; the menu order is in `src/features/index.ts`. A feature with no handlers shows as "(скоро)".
- `src/lib/book/` is shared code, not a feature: code that reads books (EPUB, PDF, `book.md`), shared by the book features (audiobook, translate). Shared code goes in `src/lib/<topic>/` and the features import it.
- `src/lib/library/` mirrors `data/` into a Telegram forum group (a topic per book, one for karaoke); features call its sync instead of sending result files. Its `/publish` command is the feature `src/features/library/`. State is in `data/library.json`.
- Heavy jobs run one at a time through `src/lib/jobs/jobs.ts`.
- Python code is one package, `src/dzhura_helper_bot/`, with a subpackage per unit (`audiobook`, `book`, `karaoke`, `summary`, `translate`, `video`); `uv sync` installs it. The TS side starts a script with `runPython("dzhura_helper_bot.<unit>.<script>", ...)` (`src/lib/python/python.ts`), which runs `uv run --quiet python -m <module>` and talks over stdin/stdout. Imports are absolute (`from dzhura_helper_bot.audiobook.uk.prepare import ...`). Python tests are in `tests/<unit>/`, mirroring the package.
- Working data (books, audio, videos) goes to `data/` (git-ignored). Secrets are in `.env` (`BOT_TOKEN`, `OWNER_ID`).
- Specs go to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, plans to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. Both are git-ignored: local working notes, not part of the open-source repo.
- Releases happen on `git push`; never raise the version or edit `CHANGELOG.md` by hand. The `pre-push` git hook runs `scripts/release.mjs`: with commits since the last `vX.Y.Z` tag it raises the version in `package.json`, `package-lock.json`, `pyproject.toml` and `uv.lock` (a breaking commit: major, or minor below 1.0; `feat`: minor; anything else: patch), adds the commits to `CHANGELOG.md`, commits `chore(release): vX.Y.Z`, tags it and stops the push. Push again: the tag goes along, and `.github/workflows/release.yml` publishes a GitHub Release with that version's notes, taken from `CHANGELOG.md` on `main` (fix a wrong entry there by hand, then rerun the workflow for its tag).
- Research reports (git-ignored): `docs/superpowers/reports/<title>/` holds one report, `<title>.md`, and its notes in `Нотатки/<Тема>.md`. Title in the request's language, sentence case, 3–6 words, plain spaces. This overrides the deep-research skill's own layout: give its subagents these paths and look for earlier research in `docs/superpowers/reports/*/`.
