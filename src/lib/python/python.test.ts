import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPython } from "./python.ts";

describe("runPython", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([false, true])(
    "rejects, without an unhandled error, when uv is missing (background: %s)",
    async (background) => {
      vi.stubEnv("PATH", "/nonexistent");
      const read = async () => {
        for await (const _line of runPython(
          "dzhura_helper_bot.video.info",
          {},
          { schema: z.object({}), background },
        )) {
          // no output expected
        }
      };
      await expect(read()).rejects.toThrow(/ENOENT/);
    },
  );

  it("stops a module that prints nothing for idleMs and says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "python-"));
    await writeFile(
      join(dir, "hang.py"),
      "import time\nprint('{\"step\": 1}', flush=True)\ntime.sleep(60)\n",
    );
    vi.stubEnv("PYTHONPATH", dir);
    const lines: unknown[] = [];
    const read = async () => {
      for await (const line of runPython(
        "hang",
        {},
        { schema: z.object({ step: z.number() }), idleMs: 3000 },
      ))
        lines.push(line);
    };
    await expect(read()).rejects.toThrow(
      /^hang was stopped: no output for 3 s$/,
    );
    expect(lines).toEqual([{ step: 1 }]);
  }, 20_000);

  async function readAll(source: string, schema: z.ZodType) {
    const dir = await mkdtemp(join(tmpdir(), "python-"));
    await writeFile(join(dir, "talk.py"), source);
    vi.stubEnv("PYTHONPATH", dir);
    const lines: unknown[] = [];
    for await (const line of runPython("talk", {}, { schema }))
      lines.push(line);
    return lines;
  }

  it("names the script and the start of a line that is not JSON", async () => {
    await expect(
      readAll("print('{oops ' + 'x' * 200, flush=True)\n", z.object({})),
    ).rejects.toThrow(/^talk: bad output line: \{oops x{74}$/);
  });

  it("names the script and the problem of a line that does not fit the schema", async () => {
    await expect(
      readAll(
        'print(\'{"step": "one"}\', flush=True)\n',
        z.object({ step: z.number() }),
      ),
    ).rejects.toThrow(/^talk: output line does not fit: .*step/s);
  });

  it("kills the script when it stops early on a bad line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "python-"));
    const pidFile = join(dir, "pid");
    await writeFile(
      join(dir, "talk.py"),
      `import os, time\nopen(${JSON.stringify(pidFile)}, "w").write(str(os.getpid()))\nprint("{oops", flush=True)\ntime.sleep(60)\n`,
    );
    vi.stubEnv("PYTHONPATH", dir);
    const started = Date.now();
    await expect(
      (async () => {
        for await (const _line of runPython(
          "talk",
          {},
          { schema: z.object({}) },
        )) {
          // the first line is bad
        }
      })(),
    ).rejects.toThrow(/bad output line/);
    expect(Date.now() - started).toBeLessThan(15_000);
    const pid = Number(await readFile(pidFile, "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 50 && alive(); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(alive()).toBe(false);
  }, 30_000);

  it("yields the lines that fit the schema", async () => {
    expect(
      await readAll(
        "print('{\"step\": 1}', flush=True)\n",
        z.object({ step: z.number() }),
      ),
    ).toEqual([{ step: 1 }]);
  });
});
