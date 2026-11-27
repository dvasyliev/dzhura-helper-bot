/** A file message the library wants posted. */
export type FileItem = {
  key: string;
  kind: "audio" | "document" | "photo" | "video";
  file: string;
  /** The file name Telegram shows; the file's own name when omitted. */
  name?: string;
  size: number;
  mtime: number;
  /** Telegram HTML. */
  caption?: string;
  title?: string;
  /** An audio's artist line. */
  performer?: string;
  /** A small JPEG shown as an audio's album art. */
  thumbnail?: string;
  video?: { duration: number; width: number; height: number };
  /** Pinned when sent. */
  pin?: boolean;
};

/** A text message the library wants posted. */
export type TextItem = {
  key: string;
  kind: "text";
  /** Telegram HTML. */
  text: string;
  /** One row of buttons under the text. */
  buttons?: { text: string; data: string }[];
  /** A picture's URL, shown large above the text as its link preview. */
  preview?: string;
  pin?: boolean;
};

export type Item = FileItem | TextItem;

/** A message already in the chat. */
export type Posted = {
  key: string;
  messageId: number;
  kind: Item["kind"];
  version: string;
  fileId?: string;
  /** An audio sent as its own message; one without this came in an album and is sent again on its own. */
  alone?: boolean;
};

/** A string that changes when the message content must be edited. */
export function version(item: Item): string {
  if (item.kind === "text")
    return `${item.text}\n${item.buttons?.map((b) => b.data).join(" ") ?? ""}${item.preview ? `\n${item.preview}` : ""}`;
  return `${fileVersion(item)}${item.caption ?? ""}`;
}

/** The part of a file's version that changes when the file must be sent again: its content, audio title, performer and thumbnail. */
export function fileVersion(item: FileItem): string {
  const title = item.title === undefined ? "" : `${item.title}\n`;
  const performer = item.performer === undefined ? "" : `${item.performer}\n`;
  const thumbnail = item.thumbnail === undefined ? "" : "thumbnail\n";
  return `${item.size}:${item.mtime}:${title}${performer}${thumbnail}`;
}

/**
 * Compares wanted items with posted messages: `cut` is the first index where
 * the order breaks (posted[cut..] are deleted, items[cut..] sent), `edit`
 * the earlier indices whose content changed. A photo cannot replace a text message, and an audio from an album
 * cannot leave it, so both break the order.
 */
export function reconcile(
  items: Item[],
  posted: Posted[],
): { edit: number[]; cut: number } {
  const common = Math.min(items.length, posted.length);
  let cut = 0;
  while (
    cut < common &&
    items[cut]!.key === posted[cut]!.key &&
    !(items[cut]!.kind === "photo" && posted[cut]!.kind === "text") &&
    !(posted[cut]!.kind === "audio" && !posted[cut]!.alone)
  )
    cut++;
  const edit: number[] = [];
  for (let i = 0; i < cut; i++) {
    if (version(items[i]!) !== posted[i]!.version) edit.push(i);
  }
  return { edit, cut };
}
