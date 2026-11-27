import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
/** A version check answers at once; this only catches a hung program. */
const TIMEOUT_MS = 10_000;

/** A program a feature runs that the bot cannot install itself. `libass` is the ffmpeg build that draws subtitles. */
export type Tool = "ffmpeg" | "libass" | "pandoc" | "claude";

const INSTALL: Record<Tool, string> = {
  ffmpeg: "brew install ffmpeg",
  libass:
    "brew uninstall ffmpeg; brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg",
  pandoc: "brew install pandoc",
  claude: "Claude Code, signed in: see SETUP.md, step 1",
};

/** The stdout of `command`, or undefined when it is not installed or fails. */
async function output(
  command: string,
  args: string[],
): Promise<string | undefined> {
  try {
    return (await run(command, args, { timeout: TIMEOUT_MS })).stdout;
  } catch {
    return undefined; // not installed: the caller reports it as missing
  }
}

/** The tools not on this Mac; checked once at start, so a newly installed one needs a restart. */
export async function missingTools(): Promise<Set<Tool>> {
  const [filters, pandoc, claude] = await Promise.all([
    output("ffmpeg", ["-hide_banner", "-filters"]),
    output("pandoc", ["--version"]),
    output("claude", ["--version"]),
  ]);
  const missing = new Set<Tool>();
  if (filters === undefined) missing.add("ffmpeg");
  if (!filters || !/^\s*\S*\s+ass\s/m.test(filters)) missing.add("libass");
  if (pandoc === undefined) missing.add("pandoc");
  if (claude === undefined) missing.add("claude");
  return missing;
}

/** Which of `needs` are missing, each with how to install it. */
export function missingFor(
  needs: Tool[] | undefined,
  missing: ReadonlySet<Tool>,
): { tool: Tool; install: string }[] {
  return (needs ?? [])
    .filter((tool) => missing.has(tool))
    .map((tool) => ({ tool, install: INSTALL[tool] }));
}
