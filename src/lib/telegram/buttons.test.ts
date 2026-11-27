import { GrammyError, type Context } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearButtons } from "./buttons.ts";

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

const failing = (error: unknown) =>
  ({
    editMessageReplyMarkup: () => Promise.reject(error),
  }) as unknown as Context;

const telegram = (description: string) =>
  new GrammyError(
    "Call failed",
    { ok: false, error_code: 400, description },
    "editMessageReplyMarkup",
    {},
  );

describe("clearButtons", () => {
  it("removes the buttons", async () => {
    const edit = vi.fn().mockResolvedValue(true);
    await clearButtons({ editMessageReplyMarkup: edit } as unknown as Context);
    expect(edit).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    "Bad Request: message is not modified: specified new message content",
    "Bad Request: message to edit not found",
  ])("ignores «%s»", async (description) => {
    await clearButtons(failing(telegram(description)));
    expect(log).not.toHaveBeenCalled();
  });

  it("logs another Telegram error without throwing", async () => {
    await clearButtons(failing(telegram("Forbidden: bot was blocked")));
    expect(log).toHaveBeenCalledOnce();
  });

  it("logs a network error without throwing", async () => {
    await clearButtons(failing(new Error("socket hang up")));
    expect(log).toHaveBeenCalledOnce();
  });
});
