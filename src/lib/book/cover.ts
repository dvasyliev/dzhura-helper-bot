import JSZip from "jszip";
import path from "node:path/posix";
import { attr } from "./epub.ts";

/** A cover image taken out of an EPUB, with the file extension its type calls for. */
export type Cover = { data: Buffer; ext: string };

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** The EPUB's own cover image: the item marked `cover-image` (EPUB 3) or the one `<meta name="cover">` names (EPUB 2). */
export async function epubCover(data: Buffer): Promise<Cover | undefined> {
  const zip = await JSZip.loadAsync(data);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = attr(
    container?.match(/<rootfile\b[^>]*>/i)?.[0] ?? "",
    "full-path",
  );
  const opf = opfPath ? await zip.file(opfPath)?.async("string") : undefined;
  if (!opf) return undefined;

  const items = (opf.match(/<item\b[^>]*>/gi) ?? []).map((tag) => ({
    id: attr(tag, "id"),
    href: attr(tag, "href"),
    type: attr(tag, "media-type"),
    props: attr(tag, "properties").split(" "),
  }));
  const metaId = (opf.match(/<meta\b[^>]*>/gi) ?? [])
    .filter((tag) => attr(tag, "name") === "cover")
    .map((tag) => attr(tag, "content"))[0];
  const item =
    items.find((i) => i.props.includes("cover-image")) ??
    items.find((i) => metaId && i.id === metaId);
  const ext = item && EXTENSIONS[item.type];
  if (!item || !ext) return undefined;

  const file = zip.file(
    path.join(path.dirname(opfPath), decodeURIComponent(item.href)),
  );
  return file ? { data: await file.async("nodebuffer"), ext } : undefined;
}
