import { audiobook } from "./audiobook/index.ts";
import { epub } from "./epub/index.ts";
import { karaoke } from "./karaoke/index.ts";
import { summary } from "./summary/index.ts";
import { translate } from "./translate/index.ts";
import type { Feature } from "../lib/feature/types.ts";

/** Menu order. A feature without `composer` is shown as «soon» and is not built yet. */
export const FEATURES: Feature[] = [
  audiobook,
  translate,
  epub,
  karaoke,
  summary,
];
