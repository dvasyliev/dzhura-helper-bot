import { z } from "zod";

/** Open Library (https://openlibrary.org): the one service the book's year, pages and cover come from. */
const SEARCH_URL = "https://openlibrary.org/search.json";
const COVERS_URL = "https://covers.openlibrary.org/b/id";
/** A generic name, no contact details: Open Library asks for an identifying User-Agent. */
const HEADERS = { "User-Agent": "dzhura-helper-bot" };
const SEARCH_TIMEOUT_MS = 8000;
const COVER_TIMEOUT_MS = 15000;

const SEARCH = z.object({
  docs: z.array(
    z.object({
      cover_i: z.number().optional(),
      first_publish_year: z.number().optional(),
      number_of_pages_median: z.number().optional(),
    }),
  ),
});

export type OpenLibraryBook = {
  coverId?: number;
  year?: number;
  pages?: number;
};

/** One request: a failure (status, timeout, network) is logged with its time and thrown to the caller. */
async function call(url: string, timeoutMs: number): Promise<Response> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res;
  } catch (error) {
    console.error(
      `Open Library ${new URL(url).pathname} failed after ${Date.now() - started} ms:`,
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

/** The best match for a title and author, or undefined when Open Library knows no such book. */
export async function findBook(
  title: string,
  author?: string,
): Promise<OpenLibraryBook | undefined> {
  const query = new URLSearchParams({
    title,
    ...(author ? { author } : {}),
    limit: "1",
    fields: "key,title,cover_i,first_publish_year,number_of_pages_median",
  });
  const res = await call(`${SEARCH_URL}?${query}`, SEARCH_TIMEOUT_MS);
  const [doc] = SEARCH.parse(await res.json()).docs;
  return (
    doc && {
      coverId: doc.cover_i,
      year: doc.first_publish_year,
      pages: doc.number_of_pages_median,
    }
  );
}

/** The large cover image (a JPEG) of `coverId`; Open Library redirects to it. */
export async function downloadCover(coverId: number): Promise<Buffer> {
  // default=false: a missing cover is a 404, not a 1-pixel picture.
  const res = await call(
    `${COVERS_URL}/${coverId}-L.jpg?default=false`,
    COVER_TIMEOUT_MS,
  );
  return Buffer.from(await res.arrayBuffer());
}
