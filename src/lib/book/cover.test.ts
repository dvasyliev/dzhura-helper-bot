import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { epubCover } from "./cover.ts";

const IMAGE = Buffer.from([1, 2, 3]);

async function epub(manifest: string, metadata = ""): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<package><metadata>${metadata}</metadata><manifest>${manifest}</manifest></package>`,
  );
  zip.file("OEBPS/images/cover.png", IMAGE);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("epubCover", () => {
  it("finds the item marked cover-image", async () => {
    const data = await epub(
      `<item id="c" href="images/cover.png" media-type="image/png" properties="cover-image"/>`,
    );
    expect(await epubCover(data)).toEqual({ data: IMAGE, ext: "png" });
  });

  it("finds the item an EPUB 2 meta tag names", async () => {
    const data = await epub(
      `<item id="pic" href="images/cover.png" media-type="image/png"/>`,
      `<meta content="pic" name="cover"/>`,
    );
    expect(await epubCover(data)).toEqual({ data: IMAGE, ext: "png" });
  });

  it("has none when the EPUB names no cover", async () => {
    const data = await epub(
      `<item id="pic" href="images/cover.png" media-type="image/png"/>`,
    );
    expect(await epubCover(data)).toBeUndefined();
  });
});
