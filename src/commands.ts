import type { BotCommand } from "grammy/types";
import { PUBLISH_COMMAND } from "./features/library/index.ts";
import type { Feature } from "./features/types.ts";

/** A feature's name in the menu; one not built yet is marked «soon». */
export function label(feature: Feature): string {
  return feature.composer ? feature.title : `${feature.title} (soon)`;
}

/**
 * The «Menu» list next to the input field: one short line with an emoji each. What to send comes as the reply to the
 * command itself.
 */
export function menuCommands(features: Feature[]): BotCommand[] {
  return [
    { command: "menu", description: "📋 Menu" },
    ...features.flatMap((f) => [
      { command: f.id, description: label(f) },
      ...(f.commands ?? []),
    ]),
    PUBLISH_COMMAND,
  ];
}
