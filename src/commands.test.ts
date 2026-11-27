import { describe, expect, it } from "vitest";
import { menuCommands } from "./commands.ts";
import { FEATURES } from "./features/index.ts";

describe("menuCommands", () => {
  const commands = menuCommands(FEATURES);

  it("lists the menu, every feature and their extra commands", () => {
    expect(commands.map((c) => c.command)).toEqual([
      "menu",
      "audiobook",
      "regen",
      "translate",
      "epub",
      "karaoke",
      "summary",
      "publish",
    ]);
  });

  it.each(commands.map((c) => [c.command, c.description]))(
    "/%s is short and starts with an emoji: %s",
    (_command, description) => {
      expect(description).toMatch(/^\p{Extended_Pictographic}/u);
      expect(description.length).toBeLessThanOrEqual(25);
    },
  );
});
