import type { Composer, Context } from "grammy";

/** One thing the bot can do; it shows up as a button in the /start menu. */
export type Feature = {
  id: string;
  title: string;
  /** What to send to use it; shown when its menu button is pressed. Omit for features not built yet. */
  hint?: string;
  /** Replaces `hint` when the reply needs more than text, e.g. buttons. */
  open?: (ctx: Context) => Promise<unknown>;
  /** Extra commands for the Telegram «Menu» list; their handlers live in `composer`. */
  commands?: { command: string; description: string }[];
  /** Handlers for the feature's messages and buttons. */
  composer?: Composer<Context>;
};
