import { Bot, InlineKeyboard, type Context } from "grammy";
import { config } from "./config.ts";
import { FEATURES } from "./features/index.ts";
import type { Feature } from "./features/types.ts";

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  bot.use(async (ctx, next) => {
    if (ctx.from?.id === config.ownerId) await next();
  });

  // The «Menu» button next to the input field lists these commands.
  void bot.api
    .setMyCommands([
      { command: "menu", description: "Що вміє бот" },
      ...FEATURES.map((f) => ({ command: f.id, description: label(f) })),
    ])
    .catch((error) => console.error("setMyCommands failed:", error));

  bot.command(["start", "menu"], (ctx) => ctx.reply("Що зробимо?", { reply_markup: menu() }));
  for (const feature of FEATURES) bot.command(feature.id, (ctx) => open(ctx, feature));

  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => {
    const feature = FEATURES.find((f) => f.id === ctx.match[1]);
    if (!feature?.composer) return ctx.answerCallbackQuery({ text: NOT_READY, show_alert: true });
    await ctx.answerCallbackQuery();
    await open(ctx, feature);
  });

  for (const feature of FEATURES) if (feature.composer) bot.use(feature.composer);

  // Nothing above took the message.
  bot.on("message", (ctx) => ctx.reply("Не знаю, що з цим робити. Оберіть дію:", { reply_markup: menu() }));

  bot.catch((err) => console.error(err.error));
  return bot;
}

const NOT_READY = "Цієї функції ще немає, вона в розробці.";

function open(ctx: Context, feature: Feature) {
  return ctx.reply(feature.composer ? (feature.hint ?? feature.title) : NOT_READY);
}

function label(feature: Feature): string {
  return feature.composer ? feature.title : `${feature.title} (скоро)`;
}

function menu(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const feature of FEATURES) keyboard.text(label(feature), `menu:${feature.id}`).row();
  return keyboard;
}
