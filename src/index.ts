import { enableYoutube } from "./features/karaoke/index.ts";
import { config } from "./lib/config/config.ts";
import { reportAiTo } from "./lib/claude/ai-usage.ts";
import { setOwnerId } from "./lib/telegram/owner.ts";
import { createBot } from "./bot.ts";
import { missingTools } from "./lib/tools/tools.ts";

setOwnerId(config.ownerId);
if (
  config.googleClientId &&
  config.googleClientSecret &&
  config.youtubePlaylistId
)
  enableYoutube({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    playlistId: config.youtubePlaylistId,
  });
const missing = await missingTools();
if (missing.size)
  console.warn(
    `Not installed: ${[...missing].join(", ")}; the menu marks the features that need them.`,
  );
const bot = createBot(config.botToken, missing);
reportAiTo(bot.api);
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
await bot.start({ onStart: (me) => console.log(`@${me.username} started`) });
