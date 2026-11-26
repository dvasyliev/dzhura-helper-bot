import JSZip from "jszip";
import { http, HttpResponse } from "msw";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "./epub.ts";
import { bookInfo, readInfo } from "./info.ts";
import { mockServer } from "./msw.testing.ts";

const server = mockServer();
const book: Book = {
  title: "The Dip",
  author: "Seth Godin",
  chapters: [{ title: "One", text: "x".repeat(3600) }],
};
const JPEG = new Uint8Array([255, 216, 255]);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "info-"));
  await mkdir(join(root, "Dip"), { recursive: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function openLibrary(
  doc: object | undefined = {
    cover_i: 5,
    first_publish_year: 2007,
    number_of_pages_median: 96,
  },
) {
  server.use(
    http.get("https://openlibrary.org/search.json", () =>
      HttpResponse.json({ docs: doc ? [doc] : [] }),
    ),
    http.get("https://covers.openlibrary.org/b/id/5-L.jpg", () =>
      HttpResponse.arrayBuffer(JPEG.buffer),
    ),
  );
}

describe("bookInfo", () => {
  it("gets the cover, year and pages from Open Library and a description from Claude, once", async () => {
    openLibrary();
    const run = vi.fn(async () => " Коротка книга. ");
    const info = await bookInfo("Dip", book, { root, run });
    expect(info).toEqual({
      cover: join(root, "Dip", "cover.jpg"),
      year: 2007,
      pages: 96,
      description: "Коротка книга.",
    });
    expect(await readFile(join(root, "Dip", "cover.jpg"))).toEqual(
      Buffer.from(JPEG),
    );
    expect(await bookInfo("Dip", book, { root, run })).toEqual(info);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("takes the EPUB's own cover before Open Library's", async () => {
    openLibrary();
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      `<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>`,
    );
    zip.file(
      "c.opf",
      `<package><manifest><item id="i" href="own.png" media-type="image/png" properties="cover-image"/></manifest></package>`,
    );
    zip.file("own.png", Buffer.from([7]));
    await writeFile(
      join(root, "Dip", "dip.epub"),
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    const info = await bookInfo("Dip", book, { root, run: async () => "d" });
    expect(info.cover).toBe(join(root, "Dip", "cover.png"));
  });

  it("leaves out what failed and estimates the pages", async () => {
    server.use(
      http.get("https://openlibrary.org/search.json", () =>
        HttpResponse.text("down", { status: 500 }),
      ),
    );
    const run = async () => {
      throw new Error("limit");
    };
    expect(await bookInfo("Dip", book, { root, run })).toEqual({ pages: 2 });
  });

  it("gives up waiting but finishes in the background for the next time", async () => {
    openLibrary({});
    let finish: (text: string) => void = () => {};
    const run = () => new Promise<string>((resolve) => (finish = resolve));
    const first = await bookInfo("Dip", book, { root, run, waitMs: 20 });
    expect(first).toEqual({});
    finish("Пізніше.");
    await vi.waitFor(async () =>
      expect(await readInfo("Dip", root)).toMatchObject({
        description: "Пізніше.",
      }),
    );
  });

  it("gives a translation its original's cover and pages with its own description", async () => {
    openLibrary();
    const orig = await bookInfo("Dip", book, {
      root,
      run: async () => "Оригінал",
    });
    await mkdir(join(root, "Dip", "translation"), { recursive: true });
    const run = vi.fn(async () => "Переклад");
    const uk = await bookInfo(
      "Dip/translation",
      { title: "Занурення", chapters: book.chapters },
      { root, run },
    );
    expect(uk).toEqual({ ...orig, description: "Переклад" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
