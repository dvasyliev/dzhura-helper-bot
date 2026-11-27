import { describe, expect, it, vi } from "vitest";
import {
  levelMarkdown,
  linkTimes,
  summaryInput,
  writeLevel,
} from "./summarize.ts";

const INFO = {
  title: "Big <Talk>",
  channel: "TED",
  categories: ["Education"],
  chapters: [
    { start: 0, title: "Intro" },
    { start: 3725, title: "End" },
  ],
};

describe("summaryInput", () => {
  it("gives the title, channel, chapters and the transcript", () => {
    expect(summaryInput(INFO, "[0:00] hello\n")).toBe(
      [
        "<video>",
        "Title: Big <Talk>",
        "Channel: TED",
        "Chapters:",
        "[0:00] Intro",
        "[1:02:05] End",
        "</video>",
        "<transcript>",
        "[0:00] hello",
        "</transcript>",
      ].join("\n"),
    );
  });
});

describe("linkTimes", () => {
  it("turns every [time] into a link to that moment, once", () => {
    const md = "### [1:02:05] Кінець\n- Думка. [0:07]\n- [0:08](x) вже";
    expect(linkTimes(md, "abc")).toBe(
      "### [1:02:05](https://youtu.be/abc?t=3725) Кінець\n- Думка. [0:07](https://youtu.be/abc?t=7)\n- [0:08](x) вже",
    );
  });
});

describe("levelMarkdown", () => {
  it("puts the title, the level, the channel and the link above the linked reply", () => {
    expect(
      levelMarkdown(INFO, "abc", "brief", "### Тема\n\n- Думка. [0:07]\n"),
    ).toBe(
      "# Big <Talk>\n\n## Стисло\n\nTED · https://youtu.be/abc\n\n### Тема\n\n- Думка. [0:07](https://youtu.be/abc?t=7)\n",
    );
    expect(levelMarkdown(INFO, "abc", "detailed", "x")).toContain(
      "## Детально",
    );
  });
});

describe("writeLevel", () => {
  it("asks Claude with the level's prompt", async () => {
    const run = vi.fn(async (_prompt: string, _input: string) => "reply");
    expect(await writeLevel("detailed", INFO, "[0:00] hi", run)).toBe("reply");
    expect(run.mock.calls[0]![0]).toMatch(/prompt-detailed\.md$/);
  });
});
