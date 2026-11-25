import { describe, expect, it, vi } from "vitest";
import { busyWith, startJob } from "./jobs.ts";

describe("startJob", () => {
  it("runs one job at a time and frees the slot when it ends, even on error", async () => {
    let finish!: () => void;
    const first = new Promise<void>((resolve) => (finish = resolve));
    expect(startJob("book", () => first, vi.fn())).toBe(true);
    expect(busyWith()).toBe("book");
    expect(startJob("karaoke", async () => {}, vi.fn())).toBe(false);

    finish();
    await vi.waitFor(() => expect(busyWith()).toBeUndefined());

    const onError = vi.fn(async () => {});
    expect(
      startJob("failure", () => Promise.reject(new Error("x")), onError),
    ).toBe(true);
    await vi.waitFor(() => expect(busyWith()).toBeUndefined());
    expect(onError).toHaveBeenCalledOnce();
  });
});
