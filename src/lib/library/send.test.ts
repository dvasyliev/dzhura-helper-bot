import type { Api } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { syncBook } from "./books.ts";
import { sendEpub } from "./send.ts";

vi.mock("./books.ts", () => ({ syncBook: vi.fn() }));

describe("sendEpub", () => {
  const fakeApi = () => ({
    sendDocument: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
  });

  it("group exists, nothing changed → no sendDocument, Done → link of the key", async () => {
    vi.mocked(syncBook).mockResolvedValueOnce({
      changed: [],
      link: (key) => (key === "epub" ? "https://t.me/c/1/2/3" : undefined),
    });
    const api = fakeApi();
    await sendEpub(
      api as unknown as Api,
      5,
      "Book",
      "/t/book.epub",
      "A",
      "epub",
      { what: "Book EPUB", title: "A" },
    );
    expect(syncBook).toHaveBeenCalledWith(api, "Book");
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith(
      5,
      '<b>✅ Done: Book EPUB</b> - <a href="https://t.me/c/1/2/3">A</a>',
      { parse_mode: "HTML" },
    );
  });

  it("group exists but has no link → sends nothing", async () => {
    vi.mocked(syncBook).mockResolvedValueOnce({
      changed: [],
      link: () => undefined,
    });
    const api = fakeApi();
    await sendEpub(
      api as unknown as Api,
      5,
      "Book",
      "/t/book.epub",
      "A",
      "epub",
      { what: "Book EPUB", title: "A" },
    );
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("without a group sends the EPUB here", async () => {
    vi.mocked(syncBook).mockResolvedValueOnce(undefined);
    const api = fakeApi();
    await sendEpub(
      api as unknown as Api,
      5,
      "Book",
      "/t/book.epub",
      "A",
      "epub",
      { what: "Book EPUB", title: "A" },
    );
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
  });
});
