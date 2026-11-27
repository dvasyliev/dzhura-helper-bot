import type { Composer, Context } from "grammy";
import type { Input } from "../input/input.ts";
import type { Tool } from "../tools/tools.ts";

/** One thing the bot can do; it shows up as a button in the /start menu. */
export type Feature = {
  id: string;
  title: string;
  /** What to send to use it, as HTML; shown when its menu button is pressed. Omit for features not built yet. */
  hint?: string;
  /** Replaces `hint` when the reply needs more than text, e.g. buttons. */
  open?: (ctx: Context) => Promise<unknown>;
  /** Programs it runs that may not be installed; the menu marks the feature and says how to install them. */
  needs?: Tool[];
  /** Extra commands for the Telegram «Menu» list; their handlers live in `composer`. */
  commands?: { command: string; description: string }[];
  /** Handlers for the feature's messages and buttons. */
  composer?: Composer<Context>;
  /** The card buttons this feature offers for a sent book or link; nothing when it can't handle it. */
  actions?: (input: Input) => Promise<Actions | undefined>;
};

/** A feature's part of the action card. */
export type Actions = {
  /** Buttons whose callbacks the feature's composer handles. */
  buttons: { text: string; data: string }[];
  /** Status lines (HTML) under the card's summary, e.g. how much is voiced. */
  lines?: string[];
  /** The feature's next step when it is only a question; shown at once when no other feature has an action. */
  ask?: (ctx: Context) => Promise<unknown>;
};
