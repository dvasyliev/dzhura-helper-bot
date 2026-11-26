import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const LIBRARY_FILE = "data/library.json";

const postedSchema = z.object({
  key: z.string(),
  messageId: z.number(),
  kind: z.enum(["text", "audio", "document", "photo", "video"]),
  version: z.string(),
  fileId: z.string().optional(),
  alone: z.boolean().optional(),
});

const topicSchema = z.object({
  threadId: z.number(),
  messages: z.array(postedSchema),
  tooBig: z.record(z.string(), z.string()),
});

const stateSchema = z.object({
  chatId: z.number().optional(),
  /** The group the bot left: coming back to it keeps the topics. */
  lastChatId: z.number().optional(),
  topics: z.record(z.string(), topicSchema),
});

export type Topic = z.infer<typeof topicSchema>;
export type LibraryState = z.infer<typeof stateSchema>;

/** Reads the library state; a missing file is an empty library, a broken one throws. */
export async function loadState(file = LIBRARY_FILE): Promise<LibraryState> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { topics: {} };
    throw error;
  }
  try {
    return stateSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error(`Invalid ${file}: ${(error as Error).message}`);
  }
}

/** Writes through a temp file and `rename`, so a crash never leaves half a file. */
export async function saveState(
  state: LibraryState,
  file = LIBRARY_FILE,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  // A temp file of its own, so two saves at once never rename the same one.
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2));
  await rename(temp, file);
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs `work` after every earlier call has finished: one sync at a time. */
export function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}
