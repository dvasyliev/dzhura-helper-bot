const PRICE_PER_BYTE_USD = 15 / 1_000_000;

export function chapterName(index: number, title: string, part?: number): string {
  const letter = part === undefined ? "" : String.fromCharCode(97 + part);
  return `${String(index).padStart(3, "0")}${letter} ${title}`;
}

export function safeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_");
}

/** Splits text into pieces of at most `max` characters, on sentence boundaries where possible. */
export function splitText(text: string, max = 2000): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…])\s+/).flatMap((s) => splitOnSpaces(s, max));

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) current = sentence;
    else if (current.length + 1 + sentence.length <= max) current += ` ${sentence}`;
    else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitOnSpaces(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const pieces: string[] = [];
  let current = "";
  for (const word of sentence.split(" ")) {
    if (current && current.length + 1 + word.length > max) {
      pieces.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Concatenates consecutive buffers into parts no larger than `maxBytes`. */
export function groupParts(buffers: Buffer[], maxBytes: number): Buffer[] {
  const parts: Buffer[] = [];
  let current: Buffer[] = [];
  let size = 0;
  for (const buffer of buffers) {
    if (current.length && size + buffer.length > maxBytes) {
      parts.push(Buffer.concat(current));
      current = [];
      size = 0;
    }
    current.push(buffer);
    size += buffer.length;
  }
  if (current.length) parts.push(Buffer.concat(current));
  return parts;
}

export function estimateCostUsd(texts: string[]): number {
  const bytes = texts.reduce((sum, t) => sum + Buffer.byteLength(t, "utf8"), 0);
  return bytes * PRICE_PER_BYTE_USD;
}
