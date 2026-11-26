import { reportAiTo } from "./ai-usage.ts";
import { createBot } from "./bot.ts";

const bot = createBot();
reportAiTo(bot.api);
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
await bot.start({ onStart: (me) => console.log(`@${me.username} started`) });
