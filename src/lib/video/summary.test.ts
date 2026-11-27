import { describe, expect, it } from "vitest";
import { aboutMessage } from "./summary.ts";

describe("aboutMessage", () => {
  it("is the escaped title, the link and the paragraphs", () => {
    expect(aboutMessage("Big <Talk>", "abc", "Перше.\n\nДруге.\n")).toBe(
      "📝 <b>Big &lt;Talk&gt;</b>\nhttps://youtu.be/abc\n\nПерше.\n\nДруге.",
    );
  });

  it("keeps within Telegram's 4096 characters by dropping the last paragraphs", () => {
    const text = aboutMessage(
      "T",
      "abc",
      Array(10).fill("x".repeat(1000)).join("\n\n"),
    );
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain("x");
  });
});
