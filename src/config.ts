import dotenv from "dotenv";

dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  ownerId: Number(required("OWNER_ID")),
  /** Google OAuth client for uploading karaoke to YouTube; without it nothing is uploaded. */
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  /** The playlist every uploaded karaoke goes into. */
  youtubePlaylistId: process.env.YOUTUBE_PLAYLIST_ID,
};
