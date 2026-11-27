import type { BotCommand } from "grammy/types";
import { PUBLISH_COMMAND } from "./features/library/index.ts";
import type { Feature } from "./lib/feature/types.ts";
import { missingFor, type Tool } from "./lib/tools/tools.ts";

/** A feature's name in the menu; one not built yet is marked «soon», one missing a program it runs with ⚠️. */
export function label(feature: Feature, missing: ReadonlySet<Tool>): string {
  if (!feature.composer) return `${feature.title} (soon)`;
  return missingFor(feature.needs, missing).length
    ? `${feature.title} ⚠️`
    : feature.title;
}

/**
 * The «Menu» list next to the input field: one short line with an emoji each. What to send comes as the reply to the
 * command itself.
 */
export function menuCommands(
  features: Feature[],
  missing: ReadonlySet<Tool>,
): BotCommand[] {
  return [
    { command: "menu", description: "📋 Menu" },
    ...features.flatMap((f) => [
      { command: f.id, description: label(f, missing) },
      ...(f.commands ?? []),
    ]),
    PUBLISH_COMMAND,
  ];
}
