import { z } from "zod";
import { runPython } from "../python/python.ts";

const COVER = z.object({ cover: z.boolean() });

/** Writes the PDF's cover (the first upright picture on its first pages) to `out` as a JPEG; false when it has none. */
export async function pdfCover(pdf: string, out: string): Promise<boolean> {
  for await (const event of runPython(
    "dzhura_helper_bot.book.pdf_cover",
    { pdf, out },
    { schema: COVER },
  ))
    if (event.cover) return true;
  return false;
}
