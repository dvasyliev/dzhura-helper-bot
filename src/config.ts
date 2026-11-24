import dotenv from "dotenv";

dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  ownerId: Number(required("OWNER_ID")),
  fishApiKey: required("FISH_API_KEY"),
  fishVoiceId: required("FISH_VOICE_ID"),
  fishModel: process.env.FISH_MODEL || "s2.1-pro-free",
};
