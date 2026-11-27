import type { z } from "zod";
import { readFileOrUndefined } from "./absent.ts";

/**
 * The JSON file `file` read through `schema`; undefined when it does not exist. A damaged file (bad JSON, wrong
 * shape) is logged with its path and also undefined, so one bad folder does not stop the rest.
 */
export async function readJsonOrUndefined<S extends z.ZodType>(
  file: string,
  schema: S,
): Promise<z.output<S> | undefined> {
  const text = await readFileOrUndefined(file);
  if (text === undefined) return undefined;
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    console.error(`${file} unreadable:`, error);
    return undefined;
  }
}
