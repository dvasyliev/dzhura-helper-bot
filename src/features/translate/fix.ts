import { hasTerm, type Problem, type Term } from "./check.ts";
import type { TermMatch } from "./lang.ts";

export function glossaryBlock(terms: Term[]): string[] {
  if (!terms.length) return [];
  const lines = terms.map(
    (t) => `- ${t.source}: ${t.uk}${t.note ? ` (${t.note})` : ""}`,
  );
  return ["<glossary>", ...lines, "</glossary>"];
}

function problemsBlock(problems: Problem[]): string[] {
  return [
    "<problems>",
    ...problems.map((p) => `- ${p.kind}: ${p.detail}`),
    "</problems>",
  ];
}

/** The input of the whole-chunk fix: the source, its translation and the problems. */
export function fixInput(
  source: string,
  translation: string,
  problems: Problem[],
  terms: Term[],
): string {
  return [
    ...glossaryBlock(terms),
    "<source>",
    source,
    "</source>",
    "<translation>",
    translation,
    "</translation>",
    ...problemsBlock(problems),
  ].join("\n");
}

/** A word's stem: all but its last two letters, at least four; inflected forms of the word start with it. */
function stem(word: string): string {
  return word.slice(0, Math.max(word.length - 2, 4)).toLowerCase();
}

/** Indices of the paragraphs one problem is in; empty when it can't be placed in a paragraph. */
function placeProblem(
  problem: Problem,
  source: string[],
  translation: string[],
  terms: Term[],
  match: TermMatch,
): number[] {
  const where = (test: (index: number) => boolean) =>
    translation.flatMap((_, i) => (test(i) ? [i] : []));
  const lower = (i: number) => translation[i]!.toLowerCase();
  switch (problem.kind) {
    case "latin":
      return where((i) => translation[i]!.includes(problem.detail));
    case "russian-letters": {
      const letters = problem.detail.split(" ");
      return where((i) => letters.some((l) => lower(i).includes(l)));
    }
    case "russianism": {
      const word = /^"([^"\s]+)/.exec(problem.detail)?.[1];
      return word ? where((i) => lower(i).includes(stem(word))) : [];
    }
    case "glossary": {
      const name = problem.detail.split(" should be ")[0];
      const term = terms.find((t) => t.source === name);
      return term ? where((i) => hasTerm(source[i]!, term, match)) : [];
    }
    default:
      return [];
  }
}

/**
 * Indices of the translation's paragraphs the problems are in, so only they are fixed; undefined when a problem
 * needs the whole chunk (paragraph count, title line) or can't be placed.
 */
export function problemParagraphs(
  problems: Problem[],
  source: string[],
  translation: string[],
  terms: Term[],
  match: TermMatch,
): number[] | undefined {
  if (source.length !== translation.length) return undefined;
  const found = new Set<number>();
  for (const problem of problems) {
    const places = placeProblem(problem, source, translation, terms, match);
    if (!places.length) return undefined;
    for (const i of places) found.add(i);
  }
  return [...found].sort((a, b) => a - b);
}

/** The input of the paragraph fix: each paragraph to fix with its source, numbered from 1, and the problems. */
export function paragraphFixInput(
  source: string[],
  translation: string[],
  indices: number[],
  problems: Problem[],
  terms: Term[],
): string {
  return [
    ...glossaryBlock(terms),
    ...indices.flatMap((i) => [
      `<paragraph n="${i + 1}">`,
      "<source>",
      source[i]!,
      "</source>",
      "<translation>",
      translation[i]!,
      "</translation>",
      "</paragraph>",
    ]),
    ...problemsBlock(problems),
  ].join("\n");
}

/**
 * The translation with the fixed paragraphs of `reply` put in; undefined when the reply does not hold exactly the
 * asked paragraphs, each one paragraph long.
 */
export function applyParagraphFix(
  translation: string[],
  indices: number[],
  reply: string,
): string | undefined {
  const fixed = new Map<number, string>();
  for (const m of reply.matchAll(
    /<paragraph n="(\d+)">\s*([\s\S]*?)\s*<\/paragraph>/g,
  )) {
    const text = m[2]!;
    if (!text || /\n\s*\n/.test(text)) return undefined;
    fixed.set(Number(m[1]) - 1, text);
  }
  if (fixed.size !== indices.length || indices.some((i) => !fixed.has(i)))
    return undefined;
  return translation.map((p, i) => fixed.get(i) ?? p).join("\n\n");
}
