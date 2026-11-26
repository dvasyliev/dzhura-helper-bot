import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { cardFor, routeText, type Card } from "./card.ts";
import { config } from "./config.ts";
import { FEATURES } from "./features/index.ts";
import {
  PUBLISH_COMMAND,
  library,
  privateOnly,
} from "./features/library/index.ts";
import type { Feature } from "./features/types.ts";
import { receiveBook, type Input } from "./input.ts";

export function createBot(): Bot {
  const bot = new Bot(config.botToken);
  bot.api.config.use(autoRetry({ maxDelaySeconds: 300 }));

  bot.use(async (ctx, next) => {
    if (ctx.from?.id === config.ownerId) await next();
  });
  bot.use(privateOnly);
  bot.use(library);

  // The «Menu» button next to the input field lists these commands.
  void bot.api
    .setMyCommands([
      { command: "menu", description: "What the bot can do" },
      PUBLISH_COMMAND,
      ...FEATURES.flatMap((f) => [
        { command: f.id, description: label(f) },
        ...(f.commands ?? []),
      ]),
    ])
    .catch((error) => console.error("setMyCommands failed:", error));

  bot.command(["start", "menu"], (ctx) =>
    ctx.reply("What shall we do?", { reply_markup: menu() }),
  );
  for (const feature of FEATURES)
    bot.command(feature.id, (ctx) => open(ctx, feature));

  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => {
    const feature = FEATURES.find((f) => f.id === ctx.match[1]);
    if (!feature?.composer)
      return ctx.answerCallbackQuery({ text: NOT_READY, show_alert: true });
    await ctx.answerCallbackQuery();
    await open(ctx, feature);
  });

  // A sent book, or a link some feature can use, gets one card with every feature's actions, before the features see the message.
  bot.on("message:document", async (ctx, next) => {
    if (!(await receiveBook(ctx, (input) => show(ctx, input)))) await next();
  });
  bot.on("message:text", async (ctx, next) => {
    const reply = await routeText(ctx.message.text, FEATURES);
    if (reply) await answer(ctx, reply);
    else await next();
  });

  for (const feature of FEATURES)
    if (feature.composer) bot.use(feature.composer);

  // Nothing above took the message.
  bot.on("message", (ctx) =>
    ctx.reply("I don't know what to do with this. Pick an action:", {
      reply_markup: menu(),
    }),
  );

  bot.catch((err) => console.error(err.error));
  return bot;
}

const NOT_READY = "This feature isn't ready yet.";

/** Replies to a sent book with the features' actions: a card, one feature's question, or the menu. */
async function show(ctx: Context, input: Input) {
  return answer(ctx, await cardFor(input, FEATURES));
}

function answer(ctx: Context, reply: Card) {
  if (reply.kind === "ask") return reply.ask(ctx);
  if (reply.kind === "card")
    return ctx.reply(reply.text, { reply_markup: reply.keyboard });
  return ctx.reply("Nothing I can do with this yet. Pick an action:", {
    reply_markup: menu(),
  });
}

function open(ctx: Context, feature: Feature) {
  if (feature.composer && feature.open) return feature.open(ctx);
  return ctx.reply(
    feature.composer ? (feature.hint ?? feature.title) : NOT_READY,
  );
}

function label(feature: Feature): string {
  return feature.composer ? feature.title : `${feature.title} (soon)`;
}

function menu(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const feature of FEATURES)
    keyboard.text(label(feature), `menu:${feature.id}`).row();
  return keyboard;
}
