import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * Runs a Python script through uv with `input` as JSON on stdin, yielding each JSON line it prints.
 * Throws when the script exits with an error.
 */
export async function* runPython(
  script: string,
  input: unknown,
): AsyncGenerator<Record<string, unknown>> {
  const child = spawn("uv", ["run", "--quiet", "python", script], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  // A spawn error (uv missing) rejects before the loop below awaits `exited`: mark it handled now, so it does not
  // crash the bot, and still throw it from the await at the end.
  exited.catch(() => {});
  // A script that exits before reading its input breaks the pipe; the exit code below reports that.
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(input));
  for await (const line of createInterface({ input: child.stdout })) {
    if (line.startsWith("{")) yield JSON.parse(line);
  }
  const code = await exited;
  if (code !== 0)
    throw new Error(`${path.basename(script)} exited with code ${code}`);
}
