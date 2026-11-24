import { createBot } from "./bot.ts";

const bot = createBot();
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
await bot.start({ onStart: (me) => console.log(`@${me.username} запущено`) });
