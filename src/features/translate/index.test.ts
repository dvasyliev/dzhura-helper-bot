import { describe, expect, it } from "vitest";
import { folderKey } from "./button.ts";
import { progressText, reportText, translate, usageLines } from "./index.ts";

describe("reportText", () => {
  it("names fixed parts and parts with problems", () => {
    expect(reportText({ fixed: 2, problems: 1, unchecked: 0 })).toBe(
      "✅ <b>Translation finished</b>\n\n<blockquote>Fixed 2 parts\n1 still have problems (see report.json)</blockquote>",
    );
  });

  it("names the parts the checker could not check apart", () => {
    expect(reportText({ fixed: 0, problems: 1, unchecked: 3 })).toBe(
      "✅ <b>Translation finished</b>\n\n<blockquote>Fixed 0 parts\n1 still have problems (see report.json)\n3 parts were not checked: the checker failed (see report.json)</blockquote>\n\nTranslate the book again to check them; no part is translated twice.",
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

describe("usageLines", () => {
  it("sums the tokens Claude read and wrote, with the cost at API prices", () => {
    expect(
      usageLines({
        calls: 120,
        input: 1000,
        output: 350_000,
        cacheWrite: 200_000,
        cacheRead: 1_000_000,
        costUsd: 4.1,
      }),
    ).toEqual([
      "Claude: 120 calls",
      "1.2M tokens in · 350K out",
      "≈$4.10 at API prices",
    ]);
  });
});

describe("progressText", () => {
  it("shows the parts done and, once Claude was called, the usage so far", () => {
    expect(progressText("Book", { done: 0, total: 80, ran: 0 })).toBe(
      "🌐 <b>Translating «Book»</b>\n0 of 80 parts",
    );
    expect(progressText("Book", { done: 0, total: 80, ran: 0 }, 12)).toBe(
      "🌐 <b>Translating «Book»</b>\n0 of 80 parts · ≈12 min left",
    );
    expect(
      progressText("Book", {
        done: 3,
        total: 80,
        ran: 3,
        usage: {
          calls: 4,
          input: 0,
          output: 9000,
          cacheWrite: 0,
          cacheRead: 30_000,
          costUsd: 0.2,
        },
      }),
    ).toBe(
      "🌐 <b>Translating «Book»</b>\n3 of 80 parts\n\n<blockquote>Claude: 4 calls\n30K tokens in · 9K out\n≈$0.20 at API prices</blockquote>",
    );
  });
});
