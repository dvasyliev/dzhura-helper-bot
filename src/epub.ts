import JSZip from "jszip";
import { parse } from "node-html-parser";
import path from "node:path/posix";

export type Book = { title: string; chapters: { title: string; text: string }[] };

/** Spine items with less text than this are treated as covers, copyright pages and so on. */
const MIN_CHAPTER_CHARS = 200;

const BLOCK_END = /<\/(p|div|h[1-6]|li|blockquote|section|article|tr)>|<br\s*\/?>/gi;

export async function parseEpub(data: Buffer): Promise<Book> {
  const zip = await JSZip.loadAsync(data);
  const read = async (file: string) => {
    const entry = zip.file(file);
    if (!entry) throw new Error(`У EPUB немає файлу ${file}`);
    return entry.async("string");
  };

  const container = await read("META-INF/container.xml");
  const opfPath = attr(container.match(/<rootfile\b[^>]*>/i)?.[0] ?? "", "full-path");
  if (!opfPath) throw new Error("Не знайдено опис книжки (OPF)");
  const opf = await read(opfPath);
  const opfDir = path.dirname(opfPath);

  const manifest = new Map<string, { href: string; type: string; props: string }>();
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
  const bookTitle = decode(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? "") || "Книжка";

  const chapters: Book["chapters"] = [];
  for (const href of spine) {
    const html = await read(href);
    const text = htmlToText(html);
    if (text.length < MIN_CHAPTER_CHARS) continue;
    const heading = parse(html).querySelector("h1, h2, h3")?.text.trim();
    const title = toc.get(href) || heading || `Розділ ${chapters.length + 1}`;
    chapters.push({ title: clean(title), text });
  }
  return { title: clean(bookTitle), chapters };
}

/** Map of chapter file path → title, from nav.xhtml (EPUB 3) or toc.ncx (EPUB 2). */
async function readToc(
  items: { href: string; type: string; props: string }[],
  read: (file: string) => Promise<string>,
): Promise<Map<string, string>> {
  const toc = new Map<string, string>();
  const add = (base: string, href: string, title: string) => {
    const file = path.join(path.dirname(base), decodeURIComponent(href.split("#")[0]));
    if (title.trim() && !toc.has(file)) toc.set(file, title.trim());
  };

  const nav = items.find((i) => i.props.split(" ").includes("nav"));
  if (nav) {
    const root = parse(await read(nav.href));
    const tocNav = root.querySelectorAll("nav").find((n) => n.getAttribute("epub:type") === "toc") ?? root;
    for (const a of tocNav.querySelectorAll("a[href]")) add(nav.href, a.getAttribute("href")!, a.text);
    if (toc.size) return toc;
  }

  const ncx = items.find((i) => i.type === "application/x-dtbncx+xml");
  if (ncx) {
    const xml = await read(ncx.href);
    const point = /<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*\bsrc="([^"]+)"/gi;
    for (const m of xml.matchAll(point)) add(ncx.href, m[2], decode(m[1]));
  }
  return toc;
}

function htmlToText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return parse(body.replace(BLOCK_END, (m) => `${m}\n`))
    .text.replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function attr(tag: string, name: string): string {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "";
}

function decode(s: string): string {
  return parse(s).text;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
