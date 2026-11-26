import { describe, expect, it } from "vitest";
import { bold, escape, problem, quote } from "./format.ts";

describe("format", () => {
  it("escapes the three characters Telegram HTML cares about", () => {
    expect(escape("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });

  it("wraps already escaped text", () => {
    expect(bold("x")).toBe("<b>x</b>");
    expect(quote(["a", "b"])).toBe("<blockquote>a\nb</blockquote>");
  });

  it("makes an error text safe and short", () => {
    expect(problem(new Error("bad <tag>"))).toBe("bad &lt;tag&gt;");
    expect(problem("x".repeat(5000)).length).toBeLessThan(1100);
  });
});
