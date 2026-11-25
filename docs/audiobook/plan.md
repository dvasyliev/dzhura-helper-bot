# Audiobook Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal Telegram bot that turns a Ukrainian EPUB into one Fish Audio mp3 per chapter, sent in order as `NNN Chapter title`.

**Architecture:** Node.js process on the owner's Mac, grammY long polling. Pure modules (EPUB parsing, text chunking, naming, part grouping) are unit-tested; `tts.ts` calls Fish Audio; `bot.ts` wires it all together.

**Tech Stack:** Node 22+, TypeScript via `tsx`, grammY, jszip, node-html-parser, Vitest.

**Spec:** `docs/audiobook/design.md`

## Global Constraints

- Only `OWNER_ID` is served; other users get no reply.
- Fish: `POST https://api.fish.audio/v1/tts`, headers `Authorization: Bearer <FISH_API_KEY>`, `Content-Type: application/json`, `model: <FISH_MODEL>`; body `{ text, reference_id: FISH_VOICE_ID, format: "mp3", mp3_bitrate: 64 }`.
- `FISH_VOICE_ID` = `e8f78487bf5a44b6a9bf2a0369e603aa` (Fish voice «Український Диктор»); `.env.example` carries this value.
- `FISH_MODEL` default `s2.1-pro-free`. Cost estimate uses $15 per 1,000,000 UTF-8 bytes.
- Telegram limits: bot download ≤ 20 MB (`getFile`); `sendAudio` ≤ 50 MB. Use 49 MB (`49 * 1024 * 1024`) as the part limit.
- Names: 3-digit chapter number, space, title (`001 Вступ`); split parts add a letter (`001a Вступ`, `001b Вступ`). Filename = name + `.mp3`, with `/\\:*?"<>|` replaced by `_`.
- User-facing text in Ukrainian.

## Review Focus

1. EPUB whose TOC is `toc.ncx` only (EPUB 2), not `nav.xhtml` — titles must still come from the TOC.
2. Spine items with no TOC entry and no heading — title `Розділ N` with N = the chapter's own number.
3. A single sentence longer than the chunk limit — must be split on spaces, never dropped.
4. Document that is not `.epub`, or is over 20 MB — reply with a clear message, do not crash.
5. A second EPUB sent while one is processing — reply «Зачекайте, ще озвучую попередню книжку», do not start a second job.

---

### Task 1: Project setup and pure helpers (naming, chunking, parts, cost)

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore` (`node_modules`, `.env`), `.env.example`
- Create: `src/text.ts`
- Test: `src/text.test.ts`

**Interfaces:**
- Produces:
  - `chapterName(index: number, title: string, part?: number): string` — `index` is 1-based; `part` is 0-based, omitted when the chapter has one part.
  - `safeFilename(name: string): string`
  - `splitText(text: string, max = 2000): string[]`
  - `groupParts(buffers: Buffer[], maxBytes: number): Buffer[]` — concatenates consecutive buffers into parts no larger than `maxBytes` (a single buffer bigger than `maxBytes` becomes its own part).
  - `estimateCostUsd(texts: string[]): number` — total UTF-8 bytes × 15 / 1e6.

- [ ] **Step 1: Init project.** `git init`, `npm init -y`, `npm i grammy jszip node-html-parser dotenv`, `npm i -D typescript tsx vitest @types/node`. Scripts: `"start": "tsx src/index.ts"`, `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`. `"type": "module"`. `.env.example` lists `BOT_TOKEN`, `OWNER_ID`, `FISH_API_KEY`, `FISH_VOICE_ID`, `FISH_MODEL=s2.1-pro-free`.

- [ ] **Step 2: Write failing tests** in `src/text.test.ts`:

```ts
expect(chapterName(1, "Вступ")).toBe("001 Вступ");
expect(chapterName(12, "Глава", 0)).toBe("012a Глава");
expect(chapterName(12, "Глава", 1)).toBe("012b Глава");
expect(safeFilename('001 Що? Так/ні')).toBe("001 Що_ Так_ні");

const chunks = splitText("Перше речення. Друге речення! Третє?", 20);
expect(chunks).toEqual(["Перше речення.", "Друге речення!", "Третє?"]);
const long = "слово ".repeat(1000).trim();           // one sentence, ~6000 chars
const parts = splitText(long, 2000);
expect(parts.every((p) => p.length <= 2000)).toBe(true);
expect(parts.join(" ")).toBe(long);
expect(splitText("  ")).toEqual([]);

const b = (n: number) => Buffer.alloc(n);
expect(groupParts([b(3), b(3), b(3)], 6).map((x) => x.length)).toEqual([6, 3]);
expect(groupParts([b(10)], 6).map((x) => x.length)).toEqual([10]);

expect(estimateCostUsd(["аа"])).toBeCloseTo(4 * 15 / 1e6);
```

- [ ] **Step 3: Run** `npx vitest run src/text.test.ts` — expected FAIL (module missing).

- [ ] **Step 4: Implement `src/text.ts`.** `splitText`: collapse whitespace, split into sentences after `.!?…` followed by space, pack sentences greedily up to `max`; a sentence longer than `max` is split on spaces.

- [ ] **Step 5: Run** `npx vitest run src/text.test.ts` — expected PASS.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: project setup and text helpers"` (new repo, only our files).

### Task 2: EPUB parsing

**Files:**
- Create: `src/epub.ts`
- Test: `src/epub.test.ts`

**Interfaces:**
- Produces: `parseEpub(data: Buffer): Promise<Book>` with `type Book = { title: string; chapters: { title: string; text: string }[] }`.

- [ ] **Step 1: Write failing tests.** Build EPUBs in the test with jszip (`META-INF/container.xml` → `OEBPS/content.opf`, spine of xhtml files). Cases:
  - EPUB 3 with `nav.xhtml` TOC: 3 spine items → chapter titles from nav, `book.title` from `<dc:title>`.
  - EPUB 2 with `toc.ncx` only: titles from `navLabel/text`.
  - Spine item with no TOC entry but an `<h2>Пролог</h2>` → title `Пролог`.
  - Spine item with neither → `Розділ N`, N = its chapter number among kept chapters.
  - Spine item with fewer than 200 characters of text (cover) → skipped.
  - Text keeps paragraph breaks as `\n`, drops tags, decodes entities (`&nbsp;`, `&amp;`).

- [ ] **Step 2: Run** `npx vitest run src/epub.test.ts` — expected FAIL.

- [ ] **Step 3: Implement `parseEpub`.** jszip to read; `container.xml` → OPF path; manifest id→href; spine order; TOC from manifest item with `properties="nav"` or `media-type="application/x-dtbncx+xml"`; map TOC hrefs (strip `#fragment`, resolve relative to the TOC file) to spine hrefs; text via node-html-parser on `<body>`, block elements → newline. Skip items under 200 chars.

- [ ] **Step 4: Run** `npx vitest run src/epub.test.ts` — expected PASS.

- [ ] **Step 5: Commit** `git add src/epub.ts src/epub.test.ts && git commit -m "feat: parse EPUB chapters and titles"`

### Task 3: Fish Audio client

**Files:**
- Create: `src/config.ts`, `src/tts.ts`
- Test: `src/tts.test.ts`

**Interfaces:**
- Produces:
  - `config: { botToken: string; ownerId: number; fishApiKey: string; fishVoiceId: string; fishModel: string }` (from `.env` via dotenv; throws naming the missing variable).
  - `synthesize(text: string, opts?: { fetch?: typeof fetch; retries?: number }): Promise<Buffer>` — default `retries = 3`, waits 2 s × attempt between tries; throws after the last failure.

- [ ] **Step 1: Write failing tests** with an injected fake `fetch`: request goes to `https://api.fish.audio/v1/tts` with the headers and body from Global Constraints; returns the response bytes; two 503s then 200 → resolves; four 503s → rejects. Pass `retries` and stub the delay (export `sleep` and `vi.spyOn`, or accept `delayMs` option set to 0 in tests).

- [ ] **Step 2: Run** `npx vitest run src/tts.test.ts` — expected FAIL.

- [ ] **Step 3: Implement** `src/config.ts` and `src/tts.ts`.

- [ ] **Step 4: Run** `npx vitest run src/tts.test.ts` — expected PASS.

- [ ] **Step 5: Commit** `git add src/config.ts src/tts.ts src/tts.test.ts && git commit -m "feat: Fish Audio TTS client with retries"`

### Task 4: Bot wiring and live check

**Files:**
- Create: `src/bot.ts`, `src/index.ts`, `README.md` (setup: BotFather token, `@userinfobot` for `OWNER_ID`, Fish API key and voice id, `caffeinate -i npm start`)

**Interfaces:**
- Consumes: everything above.

Behavior of `src/bot.ts` (grammY `Bot`, `bot.start()` long polling):
- Middleware first: drop updates where `ctx.from?.id !== config.ownerId`.
- `/start` → «Надішліть EPUB-книжку, і я озвучу її по розділах.»
- `message:document`: not `.epub` → «Потрібен файл .epub.»; `file_size > 20 MB` → «Файл більший за 20 МБ — Telegram не дає ботам його скачати.»; job running → «Зачекайте, ще озвучую попередню книжку.»
- Otherwise download via `ctx.getFile()` + `https://api.telegram.org/file/bot<token>/<file_path>`, `parseEpub`, reply «<title>: розділів <n>. ≈<cost> $ на платній моделі (зараз модель <FISH_MODEL>).», then run the job without awaiting it in the handler (so polling keeps going).
- Job: for each chapter in order — `splitText`, `synthesize` chunks with up to 3 in parallel (keep order), `groupParts(..., 49 MB)`, `sendAudio` each part with `InputFile(buffer, safeFilename(name) + ".mp3")`, `title: name`, `performer: book.title`. On failure: «Розділ <name> пропущено: <error>» and continue. At the end: «Готово: <title>.»
- Catch all errors with `bot.catch` and log them.

- [ ] **Step 1: Implement** `src/bot.ts`, `src/index.ts`, `README.md`.
- [ ] **Step 2: Run** `npm run typecheck && npm test` — expected: no errors, all tests pass.
- [ ] **Step 3: Live check** (needs the owner's `.env`): `npm start`, send a small EPUB from the owner's account; expected: summary message, then `001 …` audio playable in Telegram, in order, with book title as performer. Send from another account — no reply.
- [ ] **Step 4: Commit** `git add src/bot.ts src/index.ts README.md && git commit -m "feat: Telegram bot that voices EPUB chapters"`
