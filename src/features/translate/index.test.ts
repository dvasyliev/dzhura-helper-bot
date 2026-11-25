import { describe, expect, it } from "vitest";
import { reportText } from "./index.ts";

describe("reportText", () => {
  it("names fixed parts and parts with problems", () => {
    expect(reportText({ fixed: 2, problems: 1, unchecked: 0 })).toBe(
      "Fixed 2 parts; 1 still have problems (see report.json).",
    );
  });

  it("names the parts the checker could not check apart", () => {
    expect(reportText({ fixed: 0, problems: 1, unchecked: 3 })).toBe(
      "Fixed 0 parts; 1 still have problems (see report.json). 3 parts were not checked: the checker failed (see report.json). Translate the book again to check them; no part is translated twice.",
    );
  });
});
