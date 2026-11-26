import { describe, expect, it } from "vitest";
import {
  applyParagraphFix,
  paragraphFixInput,
  problemParagraphs,
} from "./fix.ts";

const source = ["# One", "He went to New York.", "It was dark."];
const translation = ["# Один", "Він поїхав у Нью Йорк.", "Було темно всліпу."];
const terms = [{ source: "New York", uk: "Нью-Йорк" }];

function place(...problems: { kind: string; detail: string }[]) {
  return problemParagraphs(
    problems as never,
    source,
    translation,
    terms,
    "whole",
  );
}

describe("problemParagraphs", () => {
  it("places each kind of problem in its paragraph", () => {
    expect(
      place({ kind: "glossary", detail: "New York should be Нью-Йорк" }),
    ).toEqual([1]);
    expect(place({ kind: "russianism", detail: '"всліпу": наосліп' })).toEqual([
      2,
    ]);
    expect(place({ kind: "latin", detail: "Він" })).toEqual([1]);
    expect(
      place(
        { kind: "glossary", detail: "New York should be Нью-Йорк" },
        { kind: "russianism", detail: '"всліпу": наосліп' },
      ),
    ).toEqual([1, 2]);
  });

  it("finds an inflected russianism by its stem", () => {
    expect(
      place({ kind: "russianism", detail: '"рахувати": вважати' }),
    ).toBeUndefined();
    expect(
      problemParagraphs(
        [{ kind: "russianism", detail: '"рахувати": вважати' }],
        ["a", "b"],
        ["Так", "Він рахував."],
        [],
        "whole",
      ),
    ).toEqual([1]);
  });

  it("needs the whole chunk for the paragraph count, the title or an unplaced problem", () => {
    expect(
      place({ kind: "paragraphs", detail: "3 in the source, 4" }),
    ).toBeUndefined();
    expect(place({ kind: "title", detail: "missing" })).toBeUndefined();
    expect(place({ kind: "latin", detail: "Zzz" })).toBeUndefined();
    expect(
      problemParagraphs([], source, translation.slice(1), terms, "whole"),
    ).toBeUndefined();
  });
});

describe("paragraph fix", () => {
  it("sends only the asked paragraphs, numbered from 1", () => {
    const input = paragraphFixInput(source, translation, [1], [], terms);
    expect(input).toContain(
      '<paragraph n="2">\n<source>\nHe went to New York.',
    );
    expect(input).not.toContain("It was dark.");
  });

  it("puts the fixed paragraphs back", () => {
    const reply = '<paragraph n="2">\nВін поїхав у Нью-Йорк.\n</paragraph>';
    expect(applyParagraphFix(translation, [1], reply)).toBe(
      "# Один\n\nВін поїхав у Нью-Йорк.\n\nБуло темно всліпу.",
    );
  });

  it("rejects a reply without every asked paragraph or with a split one", () => {
    expect(
      applyParagraphFix(translation, [1, 2], '<paragraph n="2">А</paragraph>'),
    ).toBeUndefined();
    expect(
      applyParagraphFix(
        translation,
        [1],
        '<paragraph n="2">А\n\nБ</paragraph>',
      ),
    ).toBeUndefined();
    expect(applyParagraphFix(translation, [1], "Він поїхав.")).toBeUndefined();
  });
});
