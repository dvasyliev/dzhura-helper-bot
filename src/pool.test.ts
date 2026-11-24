import { describe, expect, it } from "vitest";
import { mapInOrder } from "./pool.ts";

describe("mapInOrder", () => {
  it("keeps results in input order", async () => {
    const delays = [30, 0, 10];
    const out = await mapInOrder(delays, 3, (d) => new Promise<number>((r) => setTimeout(() => r(d), d)));
    expect(out).toEqual([30, 0, 10]);
  });

  it("starts no new items after one fails and settles before rejecting", async () => {
    const started: number[] = [];
    let running = 0;
    const run = mapInOrder([0, 1, 2, 3, 4, 5], 2, async (i) => {
      started.push(i);
      running++;
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (i === 0) throw new Error("boom");
      return i;
    });
    await expect(run).rejects.toThrow("boom");
    expect(running).toBe(0);
    expect(started.length).toBeLessThanOrEqual(3);
  });
});
