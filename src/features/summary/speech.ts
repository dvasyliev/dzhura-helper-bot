/** A line that ends a sentence; a heading or a bullet without it gets a «.», so the voice pauses after it. */
const END = /[.!?…:;»"”)]$/;

/** A summary's markdown as the voice reads it: no source line, no «Зміст» («Contents») list, no links, times or markup. */
export function speechText(md: string): string {
  const lines: string[] = [];
  let contents = false;
  for (const raw of md.split("\n")) {
    if (/^#{1,6}\s/.test(raw))
      contents = /^#+\s+(?:Зміст|Contents)\s*$/.test(raw);
    if (contents) continue;
    // «Channel · https://youtu.be/…» under the title.
    if (raw.includes("https://youtu.be/") && !raw.startsWith("- ")) continue;
    const line = raw
      .replace(/\[(?:\d+:)?\d+:\d\d\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^#+\s*|^\s*[-*]\s+/, "")
      .replace(/[*`]/g, "")
      .replace(/\s+([.,!?;:])/g, "$1")
      .trim();
    lines.push(line && !END.test(line) ? `${line}.` : line);
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
