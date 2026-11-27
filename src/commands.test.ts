import { describe, expect, it } from "vitest";
import { label, menuCommands } from "./commands.ts";
import { FEATURES } from "./features/index.ts";

describe("menuCommands", () => {
  const commands = menuCommands(FEATURES, new Set());

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

describe("label", () => {
  const karaoke = FEATURES.find((f) => f.id === "karaoke")!;

  it("marks a feature whose program is missing", () => {
    expect(label(karaoke, new Set(["libass"]))).toBe("🎤 Generate karaoke ⚠️");
  });

  it("leaves a feature alone when only programs it does not need are missing", () => {
    expect(label(karaoke, new Set(["pandoc"]))).toBe("🎤 Generate karaoke");
  });
});
