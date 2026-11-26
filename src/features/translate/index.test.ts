import type { Api } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { syncBook } from "../library/books.ts";
import { folderKey } from "./button.ts";
import {
  progressText,
  reportText,
  sendEpub,
  translate,
  usageText,
} from "./index.ts";

vi.mock("../library/books.ts", () => ({ syncBook: vi.fn() }));

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

describe("sendEpub", () => {
  const fakeApi = () => ({
    sendDocument: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
  });

  it("group exists, nothing changed → no sendDocument, Done → link", async () => {
    vi.mocked(syncBook).mockResolvedValueOnce({
      changed: [],
      link: (key) => (key === "uk-epub" ? "https://t.me/c/1/2/3" : undefined),
    });
    const api = fakeApi();
    await sendEpub(api as unknown as Api, 5, "Book", "/t/book.uk.epub", "A");
    expect(syncBook).toHaveBeenCalledWith(api, "Book");
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      "Done → https://t.me/c/1/2/3",
    );
  });

  it("group exists but has no link → sends nothing", async () => {
    vi.mocked(syncBook).mockResolvedValueOnce({
      changed: [],
      link: () => undefined,
    });
    const api = fakeApi();
    await sendEpub(api as unknown as Api, 5, "Book", "/t/book.uk.epub", "A");
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("without a group sends the EPUB here", async () => {
    vi.mocked(syncBook).mockResolvedValueOnce(undefined);
    const api = fakeApi();
    await sendEpub(api as unknown as Api, 5, "Book", "/t/book.uk.epub", "A");
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
  });
});

describe("usageText", () => {
  it("sums the tokens Claude read and wrote, with the cost at API prices", () => {
    expect(
      usageText({
        calls: 120,
        input: 1000,
        output: 350_000,
        cacheWrite: 200_000,
        cacheRead: 1_000_000,
        costUsd: 4.1,
      }),
    ).toBe(
      "Claude: 120 calls, 1.2M tokens in, 350K out, ≈$4.10 at API prices.",
    );
  });
});

describe("progressText", () => {
  it("shows the parts done and, once Claude was called, the usage so far", () => {
    expect(progressText("Book", { done: 0, total: 80 })).toBe(
      "Translating «Book»: 0 of 80 parts.",
    );
    expect(
      progressText("Book", {
        done: 3,
        total: 80,
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
      "Translating «Book»: 3 of 80 parts.\nClaude: 4 calls, 30K tokens in, 9K out, ≈$0.20 at API prices.",
    );
  });
});
