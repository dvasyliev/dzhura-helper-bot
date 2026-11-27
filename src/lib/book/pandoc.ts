import { spawn } from "node:child_process";

/** The EPUB made from a book folder's book.md. */
export const BOOK_EPUB = "book.epub";

/** Builds an EPUB from a book.md with pandoc; false when pandoc is not installed. */
export function buildEpub(
  md: string,
  epub: string,
  { lang, cover }: { lang?: string; cover?: string } = {},
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pandoc",
      [
        md,
        "-o",
        epub,
        ...(lang ? ["--metadata", `lang=${lang}`] : []),
        ...(cover ? [`--epub-cover-image=${cover}`] : []),
      ],
      // A book takes pandoc seconds; minutes mean it hangs, and the kill rejects below.
      { stdio: ["ignore", "ignore", "pipe"], timeout: 5 * 60_000 },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") resolve(false);
      else reject(error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve(true);
      else
        reject(
          new Error(
            `pandoc exited with ${code ?? signal}: ${stderr.slice(0, 500)}`,
          ),
        );
    });
  });
}
