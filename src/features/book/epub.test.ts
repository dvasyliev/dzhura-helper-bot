import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEpub } from "./epub.ts";

const LONG = "Це довгий абзац тексту книжки. ".repeat(10);

type Item = { id: string; href: string; body: string };

async function buildEpub(opts: {
  items: Item[];
  nav?: Record<string, string>;
  ncx?: Record<string, string>;
  /** Raw contents of nav's `<ol>` / ncx's `<navMap>`, for nested tables of contents. */
  navList?: string;
  navMap?: string;
  metadata?: string;
}) {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
  );
  const manifest = opts.items.map(
    (i) =>
      `<item id="${i.id}" href="${i.href}" media-type="application/xhtml+xml"/>`,
  );
  if (opts.nav || opts.navList)
    manifest.push(
      `<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`,
    );
  if (opts.ncx || opts.navMap)
    manifest.push(
      `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package><metadata>${opts.metadata ?? "<dc:title>Моя книжка</dc:title>"}</metadata>
     <manifest>${manifest.join("")}</manifest>
     <spine>${opts.items.map((i) => `<itemref idref="${i.id}"/>`).join("")}</spine></package>`,
  );
  for (const i of opts.items)
    zip.file(`OEBPS/${i.href}`, `<html><body>${i.body}</body></html>`);
  if (opts.nav) {
    const links = Object.entries(opts.nav).map(
      ([href, t]) => `<li><a href="${href}">${t}</a></li>`,
    );
    zip.file(
      "OEBPS/nav.xhtml",
      `<html><body><nav epub:type="toc"><ol>${links.join("")}</ol></nav></body></html>`,
    );
  }
  if (opts.navList)
    zip.file(
      "OEBPS/nav.xhtml",
      `<html><body><nav epub:type="toc"><ol>${opts.navList}</ol></nav></body></html>`,
    );
  if (opts.navMap)
    zip.file("OEBPS/toc.ncx", `<ncx><navMap>${opts.navMap}</navMap></ncx>`);
  if (opts.ncx) {
    const points = Object.entries(opts.ncx).map(
      ([href, t]) =>
        `<navPoint><navLabel><text>${t}</text></navLabel><content src="${href}"/></navPoint>`,
    );
    zip.file("OEBPS/toc.ncx", `<ncx><navMap>${points.join("")}</navMap></ncx>`);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseEpub", () => {
  it("takes the book title and chapter titles from nav.xhtml", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: [
          { id: "a", href: "a.xhtml", body: `<p>${LONG}</p>` },
          { id: "b", href: "text/b.xhtml", body: `<p>${LONG}</p>` },
          { id: "c", href: "c.xhtml", body: `<p>${LONG}</p>` },
        ],
        nav: {
          "a.xhtml": "Перший",
          "text/b.xhtml#start": "Другий",
          "c.xhtml": "Третій",
        },
      }),
    );
    expect(book.title).toBe("Моя книжка");
    expect(book.chapters.map((c) => c.title)).toEqual([
      "Перший",
      "Другий",
      "Третій",
    ]);
  });

  it("reads the author, and names a book without a title by its file name", async () => {
    const items = [{ id: "a", href: "a.xhtml", body: `<p>${LONG}</p>` }];
    const withAuthor = await buildEpub({
      items,
      metadata:
        "<dc:title>Кобзар</dc:title><dc:creator>Тарас Шевченко</dc:creator>",
    });
    expect(await parseEpub(withAuthor, "x.epub")).toMatchObject({
      title: "Кобзар",
      author: "Тарас Шевченко",
    });
    const untitled = await parseEpub(
      await buildEpub({ items, metadata: "" }),
      "Шевченко_Кобзар.epub",
    );
    expect(untitled).toMatchObject({
      title: "Шевченко Кобзар",
      author: undefined,
    });
  });

  it("takes chapter titles from toc.ncx when there is no nav", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: [{ id: "a", href: "a.xhtml", body: `<p>${LONG}</p>` }],
        ncx: { "a.xhtml": "Глава з NCX" },
      }),
    );
    expect(book.chapters.map((c) => c.title)).toEqual(["Глава з NCX"]);
  });

  it("falls back to a short first line, then to «Розділ N»", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: [
          { id: "a", href: "a.xhtml", body: `<h2>Пролог</h2><p>${LONG}</p>` },
          { id: "b", href: "b.xhtml", body: `<p>${LONG}</p>` },
        ],
      }),
    );
    expect(book.chapters.map((c) => c.title)).toEqual(["Пролог", "Розділ 2"]);
  });

  it("cuts a file at its table of contents anchors and reads a part title with the next chapter", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: [
          {
            id: "a",
            href: "a.xhtml",
            body: `<div id="p1"><p>Частина друга</p></div><span id="c1"><p>Розділ I. Риба</p><p>${LONG}</p></span><span id="c2"><p>Розділ II. Пляшка</p><p>${LONG}</p></span>`,
          },
        ],
        ncx: {
          "a.xhtml#p1": "Частина друга",
          "a.xhtml#c1": "Розділ I. Риба",
          "a.xhtml#c2": "Розділ II. Пляшка",
        },
      }),
    );
    expect(book.chapters.map((c) => c.title)).toEqual([
      "Розділ I. Риба",
      "Розділ II. Пляшка",
    ]);
    expect(
      book.chapters[0].text.startsWith(
        "Частина друга\nРозділ I. Риба\nЦе довгий",
      ),
    ).toBe(true);
    expect(book.chapters[1].text.startsWith("Розділ II. Пляшка\n")).toBe(true);
  });

  it("keeps the levels of a nested toc.ncx", async () => {
    const point = (href: string, title: string, inner = "") =>
      `<navPoint><navLabel><text>${title}</text></navLabel><content src="${href}"/>${inner}</navPoint>`;
    const book = await parseEpub(
      await buildEpub({
        items: ["a", "b", "c"].map((id) => ({
          id,
          href: `${id}.xhtml`,
          body: `<p>${LONG}</p>`,
        })),
        navMap:
          point("a.xhtml", "One", point("b.xhtml", "One A")) +
          point("c.xhtml", "Two"),
      }),
    );
    expect(book.chapters.map((c) => [c.title, c.level])).toEqual([
      ["One", 1],
      ["One A", 2],
      ["Two", 1],
    ]);
  });

  it("keeps the levels of a nested EPUB 3 nav", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: ["a", "b"].map((id) => ({
          id,
          href: `${id}.xhtml`,
          body: `<p>${LONG}</p>`,
        })),
        navList: `<li><a href="a.xhtml">One</a><ol><li><a href="b.xhtml">One A</a></li></ol></li>`,
      }),
    );
    expect(book.chapters.map((c) => [c.title, c.level])).toEqual([
      ["One", 1],
      ["One A", 2],
    ]);
  });

  it("moves the sections of a short part page up a level", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: ["a", "b", "c"].map((id) => ({
          id,
          href: `${id}.xhtml`,
          body: id === "a" ? "<p>Частина перша</p>" : `<p>${LONG}</p>`,
        })),
        navList: `<li><a href="a.xhtml">Частина перша</a><ol><li><a href="b.xhtml">Розділ I</a></li><li><a href="c.xhtml">Розділ II</a></li></ol></li>`,
      }),
    );
    expect(book.chapters.map((c) => c.level)).toEqual([undefined, undefined]);
  });

  it("skips near-empty items such as the cover", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: [
          { id: "cover", href: "cover.xhtml", body: `<p>Обкладинка</p>` },
          { id: "a", href: "a.xhtml", body: `<p>${LONG}</p>` },
        ],
      }),
    );
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe("Розділ 1");
  });

  it("keeps paragraph breaks, drops tags and decodes entities", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: [
          {
            id: "a",
            href: "a.xhtml",
            body: `<p>Том&nbsp;і&amp;Джері</p><p><b>${LONG}</b></p>`,
          },
        ],
      }),
    );
    const text = book.chapters[0].text;
    expect(text.startsWith("Том і&Джері\n")).toBe(true);
    expect(text).not.toContain("<");
  });

  it("drops footnote markers like [1]", async () => {
    const book = await parseEpub(
      await buildEpub({
        items: [
          {
            id: "a",
            href: "a.xhtml",
            body: `<p>Протока<a href="#n1">[1]</a> і миля[23].</p><p>${LONG}</p>`,
          },
        ],
      }),
    );
    expect(book.chapters[0].text.startsWith("Протока і миля.\n")).toBe(true);
  });
});

describe("parseEpub skips pages that are not chapters", () => {
  it("does not voice the nav page or linear=no items", async () => {
    const zip = await JSZip.loadAsync(
      await buildEpub({
        items: [
          { id: "a", href: "a.xhtml", body: `<p>${LONG}</p>` },
          { id: "notes", href: "notes.xhtml", body: `<p>${LONG}</p>` },
        ],
        nav: Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [
            `x${i}.xhtml`,
            `Довга назва розділу ${i}`,
          ]),
        ),
      }),
    );
    const opf = (await zip.file("OEBPS/content.opf")!.async("string"))
      .replace(
        `<itemref idref="notes"/>`,
        `<itemref idref="notes" linear="no"/>`,
      )
      .replace("</spine>", `<itemref idref="nav"/></spine>`);
    zip.file("OEBPS/content.opf", opf);
    const book = await parseEpub(
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    expect(book.chapters).toHaveLength(1);
  });
});
