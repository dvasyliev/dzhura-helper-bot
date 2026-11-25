export function chapterName(index: number, title: string, part?: number): string {
  const letter = part === undefined ? "" : String.fromCharCode(97 + part);
  return `${String(index).padStart(3, "0")}${letter} ${title}`;
}

export function safeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_");
}

/** A book's folder: its EPUB and its audio files. */
export function bookDir(title: string): string {
  return `data/audiobook/${safeFilename(title)}`;
}
