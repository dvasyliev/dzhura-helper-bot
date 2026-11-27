import JSZip from "jszip";
import { parse, type HTMLElement } from "node-html-parser";
import path from "node:path/posix";

export type Book = {
  title: string;
  author?: string;
  /** `level` is 1 for a top-level chapter, 2 and 3 for its sections; missing when the book has no nesting. */
  chapters: { title: string; text: string; level?: number }[];
};

/** book.md has `#`, `##` and `###` chapters; deeper ones count as `###`. */
export const MAX_LEVEL = 3;

/** Spine items with less text than this are treated as covers, copyright pages and so on. */
const MIN_CHAPTER_CHARS = 200;
/** A chapter not in the table of contents is named by its first line if it is this short. */
const MAX_TITLE_CHARS = 80;

const BLOCK_END =
  /<\/(p|div|h[1-6]|li|blockquote|section|article|tr)>|<br\s*\/?>/gi;

/** `fileName` names the book when the EPUB has no title. */
export async function parseEpub(
  data: Buffer,
  fileName = "Book",
): Promise<Book> {
  const zip = await JSZip.loadAsync(data);
  const read = async (file: string) => {
    const entry = zip.file(file);
    if (!entry) throw new Error(`The EPUB has no file ${file}`);
    return entry.async("string");
  };

  const container = await read("META-INF/container.xml");
  const opfPath = attr(
    container.match(/<rootfile\b[^>]*>/i)?.[0] ?? "",
    "full-path",
  );
  if (!opfPath) throw new Error("Book description (OPF) not found");
  const opf = await read(opfPath);
  const opfDir = path.dirname(opfPath);

  const manifest = new Map<
    string,
    { href: string; type: string; props: string }
  >();
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    manifest.set(attr(tag, "id"), {
      href: path.join(opfDir, decodeURIComponent(attr(tag, "href"))),
      type: attr(tag, "media-type"),
      props: attr(tag, "properties"),
    });
  }
  // Skip the table of contents page and linear="no" items (usually notes): they are not chapters.
  const spine = (opf.match(/<itemref\b[^>]*>/gi) ?? [])
    .filter((tag) => attr(tag, "linear") !== "no")
    .map((tag) => manifest.get(attr(tag, "idref")))
    .filter((item) => item && !item.props.split(" ").includes("nav"))
    .map((item) => item!.href);

  const toc = await readToc([...manifest.values()], read);
  const meta = (tag: string) =>
    clean(
      decode(
        opf.match(
          new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)</dc:${tag}>`, "i"),
        )?.[1] ?? "",
      ),
    );
  const bookTitle =
    meta("title") || fileName.replace(/\.epub$/i, "").replace(/_/g, " ");

  const chapters: Book["chapters"] = [];
  let carried: string[] = []; // a short titled section («Частина друга») is read at the start of the next chapter
  const dropped: number[] = []; // levels of the short titled sections above; their sections move up a level
  for (const href of spine) {
    const html = await read(href);
    const entries = toc.filter((e) => e.file === href);
    for (const section of sections(html, entries)) {
      if (section.level)
        while ((dropped.at(-1) ?? 0) >= section.level) dropped.pop();
      const lines = [...carried, ...section.lines];
      if (lines.join("\n").length < MIN_CHAPTER_CHARS) {
        if (section.title) {
          carried = lines;
          if (section.level) dropped.push(section.level);
        }
        continue;
      }
      carried = [];
      const firstLine =
        section.lines[0].length <= MAX_TITLE_CHARS
          ? section.lines[0]
          : undefined;
      const title =
        section.title || firstLine || `Розділ ${chapters.length + 1}`;
      const level = section.level
        ? section.level - dropped.length
        : (chapters.at(-1)?.level ?? 1);
      chapters.push({
        title: clean(title),
        text: lines.join("\n"),
        level,
      });
    }
  }
  // A flat table of contents leaves the levels out, so the chapters are told apart by their titles later.
  if (chapters.every((c) => c.level === 1))
    for (const c of chapters) delete c.level;
  return {
    title: clean(bookTitle),
    author: meta("creator") || undefined,
    chapters,
  };
}

type TocEntry = {
  file: string;
  anchor: string;
  title: string;
  level: number;
};

/** Table of contents in reading order with each entry's nesting level, from nav.xhtml (EPUB 3) or toc.ncx (EPUB 2). */
async function readToc(
  items: { href: string; type: string; props: string }[],
  read: (file: string) => Promise<string>,
): Promise<TocEntry[]> {
  const toc: TocEntry[] = [];
  const add = (base: string, href: string, title: string, level: number) => {
    const [file, anchor = ""] = decodeURIComponent(href).split("#");
    if (title.trim())
      toc.push({
        file: path.join(path.dirname(base), file),
        anchor,
        title: title.trim(),
        level: Math.min(level, MAX_LEVEL),
      });
  };

  const nav = items.find((i) => i.props.split(" ").includes("nav"));
  if (nav) {
    const root = parse(await read(nav.href));
    const tocNav =
      root
        .querySelectorAll("nav")
        .find((n) => n.getAttribute("epub:type") === "toc") ?? root;
    for (const a of tocNav.querySelectorAll("a[href]"))
      add(nav.href, a.getAttribute("href")!, a.text, listDepth(a, tocNav));
    if (toc.length) return toc;
  }

  const ncx = items.find((i) => i.type === "application/x-dtbncx+xml");
  if (ncx) {
    const xml = await read(ncx.href);
    // Entries are in document order; a navPoint inside another is its section.
    const token =
      /<navPoint\b|<\/navPoint>|<text>([\s\S]*?)<\/text>|<content\b[^>]*\bsrc="([^"]+)"/gi;
    const open: { title?: string }[] = [];
    for (const m of xml.matchAll(token)) {
      if (m[0].toLowerCase() === "<navpoint") open.push({});
      else if (m[0].toLowerCase() === "</navpoint>") open.pop();
      else if (m[1] !== undefined) {
        const point = open.at(-1);
        if (point && point.title === undefined) point.title = decode(m[1]);
      } else if (m[2] !== undefined) {
        const title = open.at(-1)?.title;
        if (title !== undefined) add(ncx.href, m[2], title, open.length);
      }
    }
  }
  return toc;
}

/** How many lists `a` sits in, up to `root`: 1 for a top-level entry. */
function listDepth(a: HTMLElement, root: HTMLElement): number {
  let depth = 0;
  for (let node = a.parentNode; node && node !== root; node = node.parentNode)
    if (node.rawTagName?.toLowerCase() === "ol") depth += 1;
  return Math.max(depth, 1);
}

const MARK = "\u0001";

/**
 * A spine file cut where its table of contents entries point: one file often holds several chapters.
 * Text before the first anchor (or of a file with no entries) gets the title of an entry with no
 * anchor in this file, if any.
 */
function sections(
  html: string,
  entries: TocEntry[],
): { title?: string; level?: number; lines: string[] }[] {
  const marks: { at: number; entry: number }[] = [];
  entries.forEach((e, entry) => {
    const at = e.anchor
      ? html.search(
          new RegExp(
            `<[a-z][^>]*\\bid=["']${RegExp.escape(e.anchor)}["']`,
            "i",
          ),
        )
      : -1;
    if (at >= 0) marks.push({ at, entry });
  });
  for (const { at, entry } of marks.sort((a, b) => b.at - a.at))
    html = `${html.slice(0, at)}<p>${MARK}${entry}</p>${html.slice(at)}`;

  const first = entries.find((_, i) => !marks.some((m) => m.entry === i));
  const result: { title?: string; level?: number; lines: string[] }[] = [
    { title: first?.title, level: first?.level, lines: [] },
  ];
  for (const line of htmlToText(html).split("\n")) {
    if (line.startsWith(MARK)) {
      const entry = entries[Number(line.slice(1))];
      result.push({ title: entry.title, level: entry.level, lines: [] });
    } else result.at(-1)!.lines.push(line);
  }
  return result;
}

function htmlToText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return parse(body.replace(BLOCK_END, (m) => `${m}\n`))
    .text.replace(/\u00a0/g, " ")
    .replace(/\[\d+\]/g, "") // footnote markers
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function attr(tag: string, name: string): string {
  return (
    tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? ""
  );
}

function decode(s: string): string {
  return parse(s).text;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
