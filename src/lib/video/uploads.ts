import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const STORE = z.object({
  refreshToken: z.string().optional(),
  videos: z.record(z.string(), z.string()).default({}),
});

/** What the YouTube store file holds: the refresh token and the id of every upload by its title. */
export type Store = z.infer<typeof STORE>;

/** The store file, or an empty store when it is missing. A file of the wrong shape throws, naming the file. */
export function readStore(storeFile: string): Store {
  // Sync on purpose: the YouTube store updates by read-then-write with no await in between.
  if (!existsSync(storeFile)) return { videos: {} };
  try {
    return STORE.parse(JSON.parse(readFileSync(storeFile, "utf8")));
  } catch (error) {
    throw new Error(`${storeFile} is not a YouTube store: ${String(error)}`, {
      cause: error,
    });
  }
}

/** The id of every upload by its title, from the store file; empty when it is missing. The refresh token stays inside. */
export function uploads(storeFile: string): Record<string, string> {
  return readStore(storeFile).videos;
}
