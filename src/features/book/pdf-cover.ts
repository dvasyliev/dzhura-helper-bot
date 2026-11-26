import { runPython } from "../../python.ts";

/** Writes the PDF's cover (the first upright picture on its first pages) to `out` as a JPEG; false when it has none. */
export async function pdfCover(pdf: string, out: string): Promise<boolean> {
  for await (const event of runPython(
    "src/features/book/scripts/pdf_cover.py",
    { pdf, out },
  ))
    if (event.cover === true) return true;
  return false;
}
