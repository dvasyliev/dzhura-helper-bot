import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { cardFor, routeText, type Card } from "./card.ts";
import { ownerId } from "./lib/telegram/owner.ts";
import { FEATURES } from "./features/index.ts";
import { label, menuCommands } from "./commands.ts";
import { library, privateOnly } from "./features/library/index.ts";
import type { Feature } from "./lib/feature/types.ts";
import { bold, code, escape, HTML } from "./lib/text/format.ts";
import { receiveBook, type Input } from "./lib/input/input.ts";
import { bookSearch } from "./lib/input/search.ts";
import { missingFor, type Tool } from "./lib/tools/tools.ts";

/** `missing`: the programs not installed on this Mac; the menu marks the features that need them. */
export function createBot(token: string, missing: ReadonlySet<Tool>): Bot {
  const bot = new Bot(token);
  // Waits out rate limits and network drops, but gives up after a few tries so a job can't hang forever.
  bot.api.config.use(autoRetry({ maxDelaySeconds: 300, maxRetryAttempts: 5 }));

  bot.use(async (ctx, next) => {
    if (ctx.from?.id === ownerId()) await next();
  });
  bot.use(privateOnly);
  bot.use(library);

  // The «Menu» button next to the input field lists these commands.
  void bot.api
    .setMyCommands(menuCommands(FEATURES, missing))
    .catch((error) => console.error("setMyCommands failed:", error));

  bot.command(["start", "menu"], (ctx) =>
    ctx.reply(`❓ ${bold("What shall we do?")}`, {
      ...HTML,
      reply_markup: menu(missing),
    }),
  );
  for (const feature of FEATURES)
    bot.command(feature.id, (ctx) => open(ctx, feature, missing));

  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => {
    const feature = FEATURES.find((f) => f.id === ctx.match[1]);
    if (!feature?.composer)
      return ctx.answerCallbackQuery({ text: NOT_READY, show_alert: true });
    await ctx.answerCallbackQuery();
    await open(ctx, feature, missing);
  });

  // A sent book, or a link some feature can use, gets one card with every feature's actions, before the features see the message.
  bot.on("message:document", async (ctx, next) => {
    if (!(await receiveBook(ctx, (input) => show(ctx, input, missing))))
      await next();
  });
  bot.on("message:text", async (ctx, next) => {
    const reply = await routeText(ctx.message.text, FEATURES);
    if (reply) await answer(ctx, reply, missing);
    else await next();
  });

  for (const feature of FEATURES)
    if (feature.composer) bot.use(feature.composer);
  bot.use(bookSearch((ctx, input) => show(ctx, input, missing)));

  // Nothing above took the message.
  bot.on("message", (ctx) =>
    ctx.reply(
      `⚠️ ${bold("I don't know what to do with this")}\nPick an action:`,
      { ...HTML, reply_markup: menu(missing) },
    ),
  );

  bot.catch((err) => console.error(err.error));
  return bot;
}

const NOT_READY = "This feature isn't ready yet.";

/** Replies to a sent book with the features' actions: a card, one feature's question, or the menu. */
async function show(ctx: Context, input: Input, missing: ReadonlySet<Tool>) {
  return answer(ctx, await cardFor(input, FEATURES), missing);
}

async function answer(ctx: Context, reply: Card, missing: ReadonlySet<Tool>) {
  if (reply.kind === "ask") return reply.ask(ctx);
  if (reply.kind === "card") {
    const options = { ...HTML, reply_markup: reply.keyboard };
    if (reply.photo) {
      try {
        return await ctx.replyWithPhoto(new InputFile(reply.photo), {
          ...options,
          caption: reply.text,
        });
      } catch (error) {
        console.error("Sending the cover failed:", error); // the card goes out without it
      }
    }
    return ctx.reply(reply.text, options);
  }
  return ctx.reply(
    `⚠️ ${bold("Nothing I can do with this yet")}\nPick an action:`,
    { ...HTML, reply_markup: menu(missing) },
  );
}

async function open(
  ctx: Context,
  feature: Feature,
  missing: ReadonlySet<Tool>,
) {
  const tools = missingFor(feature.needs, missing);
  if (feature.composer && tools.length)
    await ctx.reply(
      [
        `⚠️ ${bold("Not installed on the Mac")}, so this may fail:`,
        ...tools.map((t) => `• ${t.tool}: ${code(escape(t.install))}`),
        "Install, then restart the bot.",
      ].join("\n"),
      HTML,
    );
  if (feature.composer && feature.open) return feature.open(ctx);
  return ctx.reply(
    feature.composer
      ? (feature.hint ?? bold(escape(feature.title)))
      : `⚠️ ${bold(NOT_READY)}`,
    HTML,
  );
}

function menu(missing: ReadonlySet<Tool>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const feature of FEATURES)
    keyboard.text(label(feature, missing), `menu:${feature.id}`).row();
  return keyboard;
}
