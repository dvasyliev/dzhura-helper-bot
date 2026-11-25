import { audiobook } from "./audiobook/index.ts";
import type { Feature } from "./types.ts";

/** Menu order. A feature without `composer` is shown as «скоро» and is not built yet. */
export const FEATURES: Feature[] = [
  audiobook,
  { id: "translate", title: "🌐 Переклад книжки" },
  { id: "karaoke", title: "🎤 Згенерувати караоке" },
  { id: "summary", title: "📝 Summary з YouTube" },
];
