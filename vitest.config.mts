import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Tests never use the real bot: these let src/lib/config/config.ts load on CI, which has no secrets file.
    env: { BOT_TOKEN: "test-token", OWNER_ID: "1" },
    include: ["**/*.{test,spec}.{js,mjs,ts}"],
    exclude: ["node_modules", ".venv", ".claude"],
  },
});
