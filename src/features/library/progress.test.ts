import { describe, expect, it, vi } from "vitest";
import { liveStatus, publishStatus } from "./progress.ts";

describe("publishStatus", () => {
  const rows = [
    {
      name: "A — One",
      state: "done" as const,
      changed: 23,
      link: "https://t.me/c/1/5",
    },
    { name: "B — Two", state: "done" as const, changed: 0 },
    { name: "C — <Three>", state: "running" as const, sent: [34, 90] as const },
    { name: "Karaoke", state: "waiting" as const },
  ];

  it("counts the topics done and shows each topic's state", () => {
    expect(publishStatus(rows)).toBe(
      [
        "📚 <b>Publishing the library</b> · 2 of 4 topics",
        "",
        '✅ 23 updated | <a href="https://t.me/c/1/5">A — One</a>',
        "✅ no changes | B — Two",
        "🔄 34 of 90 | C — &lt;Three&gt;",
        "⏳ Karaoke",
      ].join("\n"),
    );
  });

  it("says the library is up to date at the end", () => {
    const done = rows.map((r) => ({ ...r, state: "done" as const }));
    expect(publishStatus(done, "done").split("\n")[0]).toBe(
      "✅ <b>Library is up to date</b> · 4 topics",
    );
  });

  it("says publishing stopped when the group is unavailable", () => {
    expect(publishStatus(rows, "stopped").split("\n")[0]).toBe(
      "⚠️ <b>Publishing stopped</b> · the library group is unavailable",
    );
  });
});

describe("liveStatus", () => {
  it("sends once, then edits at most every interval, and always the last text", async () => {
    let now = 0;
    const send = vi.fn(async () => 9);
    const edit = vi.fn(async () => undefined);
    const show = liveStatus(send, edit, { intervalMs: 3000, now: () => now });
    await show("a");
    now = 1000;
    await show("b");
    now = 3500;
    await show("c");
    now = 4000;
    await show("d", true);
    expect(send).toHaveBeenCalledWith("a");
    expect(edit.mock.calls).toEqual([
      [9, "c"],
      [9, "d"],
    ]);
  });

  it("keeps going when an edit fails", async () => {
    const edit = vi.fn(async () => {
      throw new Error("message is not modified");
    });
    const show = liveStatus(async () => 9, edit, { intervalMs: 0 });
    await show("a");
    await expect(show("b")).resolves.toBeUndefined();
  });
});
