# Audiobook bot — design

## Intent

A personal Telegram bot: the owner sends a Ukrainian EPUB, the bot voices every
chapter with Fish Audio and sends the chapters back one by one as audio files
named `001 Chapter title`, to listen to books in Telegram. Built fast, for one
person.

## Goals

- Only the owner (`OWNER_ID`) can use it; everyone else is ignored silently.
- One audio message per chapter, in reading order, titled `NNN Chapter title`,
  performer = book title.
- Default model `s2.1-pro-free` ($0); switch to `s2.1-pro` ($15 per 1M UTF-8
  bytes, ≈ $16 per average Ukrainian book) by changing `FISH_MODEL`.

## Non-goals

- Resuming a book after a restart, a queue of several books, saving mp3 files.
- Hosting: runs on the owner's Mac (`caffeinate -i npm start`).

## Approaches considered

| Approach | Trade-off | Picked |
|---|---|---|
| Local on Mac, long polling | Fastest to build, $0, no limits; Mac must be awake | **Yes** (owner's choice) |
| Vercel Hobby + Workflows | Always on, free within 50K events/month; more to build | No |
| Cloudflare Workers + Workflows | Free plan's 10 ms CPU per step is too small for EPUB parsing | No |

## Design

- Node.js + TypeScript (`tsx`), grammY in long-polling mode.
- `.env`: `BOT_TOKEN`, `OWNER_ID`, `FISH_API_KEY`, `FISH_VOICE_ID`,
  `FISH_MODEL` (default `s2.1-pro-free`).
- EPUB: Telegram lets bots download files up to 20 MB (Bot API `getFile`); a
  bigger file gets a reply saying so. Unzip, read the OPF spine for
  reading order and the TOC (nav.xhtml or toc.ncx) for titles. Title fallback:
  first heading, then `Розділ N`. Skip near-empty spine items (cover,
  copyright).
- On receipt the bot replies with the book title, chapter count and the
  estimated cost (UTF-8 bytes × $15/1M), then starts without confirmation.
- Each chapter is split into chunks of up to ~2000 characters at sentence
  boundaries, voiced as mp3 at 64 kbps, and the chunks are concatenated.
- Chunk failure: up to 3 retries, then the bot reports the skipped chapter and
  continues.
- A chapter over Telegram's 50 MB audio limit is split into parts `001a`,
  `001b`, ….

## Left to the builder

Chunk concurrency within a chapter, the "near-empty" threshold, progress
messages.
