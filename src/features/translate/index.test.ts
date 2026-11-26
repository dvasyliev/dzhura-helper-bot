import { describe, expect, it } from "vitest";
import { folderKey } from "./button.ts";
import { reportText, translate } from "./index.ts";

describe("reportText", () => {
  it("names fixed parts and parts with problems", () => {
    expect(reportText({ fixed: 2, problems: 1, unchecked: 0 })).toBe(
      "Fixed 2 parts; 1 still have problems (see report.json).",
    );
  });

  it("names the parts the checker could not check apart", () => {
    expect(reportText({ fixed: 0, problems: 1, unchecked: 3 })).toBe(
      "Fixed 0 parts; 1 still have problems (see report.json). 3 parts were not checked: the checker failed (see report.json). Translate the book again to check them; no part is translated twice.",
    );
  });
});

describe("translate.actions", () => {
  const input = (language: "en" | "ru" | "uk") => ({
    kind: "book" as const,
    folder: "A - T",
    language,
    book: { title: "T", author: "A", chapters: [{ title: "1", text: "x" }] },
  });

  it("offers the translate button for an English or Russian book", async () => {
    for (const language of ["en", "ru"] as const) {
      const actions = await translate.actions?.(input(language));
      expect(actions?.buttons).toEqual([
        {
          text: "🌐 Translate to Ukrainian",
          data: `translate:${folderKey("A - T")}`,
        },
      ]);
      expect(actions?.ask).toBeUndefined();
    }
  });

  it("offers nothing for a Ukrainian book or a link", async () => {
    expect(await translate.actions?.(input("uk"))).toBeUndefined();
    expect(
      await translate.actions?.({ kind: "link", url: "https://a.b" }),
    ).toBeUndefined();
  });
});
