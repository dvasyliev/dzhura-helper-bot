import { GrammyError, type Context } from "grammy";

/** Telegram's answers that mean «nothing left to remove»: the buttons are already gone or the message is. */
const HARMLESS = ["message is not modified", "message to edit not found"];

/** Removes the buttons under the message `ctx` came from. A failure is logged, never thrown. */
export async function clearButtons(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup();
  } catch (error) {
    if (
      error instanceof GrammyError &&
      HARMLESS.some((text) => error.description.includes(text))
    )
      return;
    console.error("Removing the buttons failed:", error);
  }
}
