import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

/** A script silent this long is taken as hung: voicing prints after each chapter, karaoke after each step. */
const IDLE_MS = 60 * 60_000;
/** How long a stopped script has to exit before it is killed. */
const KILL_GRACE_MS = 10_000;

/**
 * Runs a Python module (`dzhura_helper_bot.<unit>.<script>`) through uv as `python -m`, with `input` as JSON on stdin,
 * yielding each JSON line it prints, read through `schema` (what the script prints for one event). A line that starts
 * with `{` but is not JSON, or does not fit `schema`, throws an error naming the script; other lines are noise.
 * Throws when the script exits with an error. A `background` job (voicing, karaoke) runs at macOS's «utility»
 * priority, so it yields the CPU and GPU to the person at the computer instead of freezing it. A script that prints
 * nothing for `idleMs` is stopped and the run throws, so a hung step does not block the job queue.
 */
export async function* runPython<S extends z.ZodType>(
  module: string,
  input: unknown,
  {
    schema,
    background = false,
    idleMs = IDLE_MS,
  }: { schema: S; background?: boolean; idleMs?: number },
): AsyncGenerator<z.output<S>> {
  const name = module.split(".").at(-1);
  const uv = ["uv", "run", "--quiet", "python", "-m", module];
  const [command, ...args] = background
    ? ["taskpolicy", "-c", "utility", ...uv]
    : uv;
  const child = spawn(command!, args, { stdio: ["pipe", "pipe", "inherit"] });
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
  const lines = createInterface({ input: child.stdout });
  let stopped = false;
  let finished = false;
  let timer: NodeJS.Timeout | undefined;
  const kill = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
  };
  const watch = () => {
    timer = setTimeout(() => {
      stopped = true;
      kill();
      lines.close(); // ends the loop below even if a grandchild keeps the pipe open
    }, idleMs);
  };
  watch();
  try {
    for await (const line of lines) {
      clearTimeout(timer); // the time the caller spends on a line is not the script's silence
      if (line.startsWith("{")) yield parseLine(name, line, schema);
      watch();
    }
    finished = true;
  } finally {
    clearTimeout(timer);
    // Stopped early (bad line, schema failure, the caller quit): do not leave the script running.
    if (!finished) kill();
  }
  const code = await exited;
  if (stopped)
    throw new Error(
      `${name} was stopped: no output for ${Math.round(idleMs / 1000)} s`,
    );
  if (code !== 0) throw new Error(`${name} exited with code ${code}`);
}

/** One line a script printed, read through `schema`; the error names the script and what is wrong. */
function parseLine<S extends z.ZodType>(
  name: string | undefined,
  line: string,
  schema: S,
): z.output<S> {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    throw new Error(`${name}: bad output line: ${line.slice(0, 80)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new Error(
      `${name}: output line does not fit: ${z.prettifyError(parsed.error)}`,
    );
  return parsed.data;
}
