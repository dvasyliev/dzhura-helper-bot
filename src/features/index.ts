import { audiobook } from "./audiobook/index.ts";
import { karaoke } from "./karaoke/index.ts";
import type { Feature } from "./types.ts";

/** Menu order. A feature without `composer` is shown as «soon» and is not built yet. */
export const FEATURES: Feature[] = [
  audiobook,
  { id: "translate", title: "🌐 Translate a book" },
  karaoke,
  { id: "summary", title: "📝 YouTube summary" },
];
