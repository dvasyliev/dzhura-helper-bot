/** A file message the library wants posted. */
export type FileItem = {
  key: string;
  kind: "audio" | "document" | "video";
  file: string;
  /** The file name Telegram shows; the file's own name when omitted. */
  name?: string;
  size: number;
  mtime: number;
  caption?: string;
  title?: string;
  performer?: string;
  video?: { duration: number; width: number; height: number };
};

/** A text message the library wants posted. */
export type TextItem = {
  key: string;
  kind: "text";
  text: string;
  button?: { text: string; data: string };
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
};

/** A string that changes when the message content must be edited. */
export function version(item: Item): string {
  if (item.kind === "text") return `${item.text}\n${item.button?.data ?? ""}`;
  return `${item.size}:${item.mtime}:${item.caption ?? ""}`;
}

/**
 * Compares wanted items with posted messages: `cut` is the first index where
 * the order breaks (posted[cut..] are deleted, items[cut..] sent), `edit`
 * the earlier indices whose content changed.
 */
export function reconcile(
  items: Item[],
  posted: Posted[],
): { edit: number[]; cut: number } {
  const common = Math.min(items.length, posted.length);
  let cut = 0;
  while (cut < common && items[cut]!.key === posted[cut]!.key) cut++;
  const edit: number[] = [];
  for (let i = 0; i < cut; i++) {
    if (version(items[i]!) !== posted[i]!.version) edit.push(i);
  }
  return { edit, cut };
}
