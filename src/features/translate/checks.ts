import { readFileSync } from "node:fs";
import { paragraphs } from "./chunks.ts";

/** A glossary entry: how a source name or term must be written in Ukrainian. */
export type Term = { source: string; uk: string; note?: string };

export type Problem = {
  kind:
    | "latin"
    | "russian-letters"
    | "paragraphs"
    | "glossary"
    | "russianism"
    | "title";
  detail: string;
};

export type Replacement = { pattern: string; suggestions: string[] };

const APOSTROPHES = /['’ʼ]/g;
const WORD = /[\p{L}'’ʼ-]+/gu;

function normalize(text: string): string {
  return text.toLowerCase().replace(APOSTROPHES, "'");
}

function words(text: string): string[] {
  return normalize(text).match(WORD) ?? [];
}

/** Puts the Ukrainian apostrophe ʼ in place of ' and ’ between two Cyrillic letters. */
export function fixApostrophes(text: string): string {
  return text.replace(
    /(?<=\p{Script=Cyrillic})['’](?=\p{Script=Cyrillic})/gu,
    "ʼ",
  );
}

function readRows(file: string): string[][] {
  const lines = readFileSync(new URL(`chysto/${file}`, import.meta.url), "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean);
  return lines.map((line) => line.split("\t"));
}

let cached: Replacement[] | undefined;

/** Correct Ukrainian words whose lt-replace rows are wrong only in phrases the table does not name. */
const CORRECT_ALONE = new Set([
  "прийом",
  "прийняв",
  "прийняли",
  "прийнято",
  "прийнятий",
  "розбили",
  "схоже",
]);

/**
 * True for an lt-replace row of one word whose note is a phrase ("Образ життя", "Всі до єдиного"):
 * the word is wrong only inside that phrase. A note listing more synonyms has `;`.
 */
function onlyInPhrase(pattern: string, note: string | undefined): boolean {
  return (
    !/\s/.test(pattern) && !!note && /\s/.test(note) && !note.includes(";")
  );
}

/** The russianism table: `error` rows of lt-replace.tsv and `error` calques. */
export function loadTable(): Replacement[] {
  if (cached) return cached;
  const rows: Replacement[] = [];
  for (const [pattern, suggestions, level, note] of readRows(
    "lt-replace.tsv",
  )) {
    // one- to four-letter words ("в", "по") are context-dependent and flag ordinary text
    if (
      level === "error" &&
      suggestions &&
      pattern &&
      (pattern.length > 4 || /\s/.test(pattern)) &&
      !onlyInPhrase(pattern, note) &&
      !CORRECT_ALONE.has(pattern)
    )
      rows.push({ pattern, suggestions: suggestions.split("|") });
  }
  for (const [pattern, suggestions, , level] of readRows(
    "chysto-calques.tsv",
  )) {
    if (pattern && suggestions && level === "error")
      rows.push({ pattern, suggestions: suggestions.split("|") });
  }
  cached = rows;
  return rows;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ADJECTIVE_ENDINGS = new Set([
  "ий",
  "ій",
  "а",
  "я",
  "е",
  "є",
  "і",
  "у",
  "ю",
  "ої",
  "ою",
  "ого",
  "ому",
  "им",
  "ім",
  "их",
  "ими",
  "их",
]);

/**
 * A one-word pattern matches the word itself. An adjective pattern (-ий, -ій, stem of at least 5 letters)
 * also matches its other forms. Anything looser flagged most ordinary words in the pilot translation.
 */
function matchesWord(pattern: string, word: string): boolean {
  if (word === pattern) return true;
  const stem = pattern.slice(0, -2);
  return (
    /[иі]й$/.test(pattern) &&
    stem.length >= 5 &&
    word.startsWith(stem) &&
    ADJECTIVE_ENDINGS.has(word.slice(stem.length))
  );
}

function findRussianisms(translation: string, table: Replacement[]): Problem[] {
  const text = normalize(translation);
  const tokens = words(translation);
  const problems: Problem[] = [];
  for (const row of table) {
    const pattern = normalize(row.pattern).trim();
    const hit = /\s/.test(pattern)
      ? new RegExp(
          `(?<![\\p{L}])${escapeRegExp(pattern)}(?![\\p{L}])`,
          "u",
        ).test(text)
      : tokens.some((token) => matchesWord(pattern, token));
    if (hit)
      problems.push({
        kind: "russianism",
        detail: `"${row.pattern}": ${row.suggestions.join(", ")}`,
      });
  }
  return problems;
}

function termHolds(term: Term, translation: string): boolean {
  const text = normalize(translation);
  // the stem is all but the last two letters, at least four; a word of four letters or fewer counts whole
  return words(term.uk).every((word) =>
    text.includes(word.slice(0, Math.max(word.length - 2, 4))),
  );
}

/** Whether a term's source form occurs in `text` as a whole word; a name (capital first letter) must match its case. */
export function hasTerm(text: string, term: Term): boolean {
  const name = /^\p{Lu}/u.test(term.source);
  return new RegExp(
    `(?<!\\p{L})${escapeRegExp(term.source)}(?!\\p{L})`,
    name ? "u" : "iu",
  ).test(text);
}

const ROMAN = /^[IVXLCDM]+$/;

/**
 * Mechanical checks of a translated chunk against its source; an empty list means nothing was found.
 * `first` (when given) says whether the chunk opens a chapter and so must start with its `# ` title line.
 */
export function checkChunk(
  source: string,
  translation: string,
  terms: Term[],
  table: Replacement[],
  first?: boolean,
): Problem[] {
  const problems: Problem[] = [];

  const sourceWords = new Set(
    (source.match(/[\p{L}]+/gu) ?? []).map((word) => word.toLowerCase()),
  );
  for (const word of translation.match(/[\p{L}]+/gu) ?? []) {
    const latin = /\p{Script=Latin}/u.test(word);
    const mixed = latin && /\p{Script=Cyrillic}/u.test(word);
    if (
      mixed ||
      (latin && !ROMAN.test(word) && !sourceWords.has(word.toLowerCase()))
    )
      problems.push({ kind: "latin", detail: word });
  }

  const letters = new Set(translation.match(/[ыъэёЫЪЭЁ]/g));
  if (letters.size)
    problems.push({ kind: "russian-letters", detail: [...letters].join(" ") });

  const before = paragraphs(source).length;
  const after = paragraphs(translation).length;
  if (before !== after)
    problems.push({
      kind: "paragraphs",
      detail: `${before} in the source, ${after} in the translation`,
    });

  if (first === true && !translation.startsWith("# "))
    problems.push({ kind: "title", detail: "the # title line is missing" });
  if (first === false && /^# /m.test(translation))
    problems.push({
      kind: "title",
      detail: "a # title line in a chunk that does not open a chapter",
    });

  for (const term of terms) {
    if (hasTerm(source, term) && !termHolds(term, translation))
      problems.push({
        kind: "glossary",
        detail: `${term.source} should be ${term.uk}`,
      });
  }

  return [...problems, ...findRussianisms(translation, table)];
}
