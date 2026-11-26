import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasGroup, resetUnavailable, withGroup } from "./group.ts";
import { saveState } from "./state.ts";
import type { Synced } from "./topic.ts";

vi.mock("../../config.ts", () => ({ config: { ownerId: 7 } }));

const synced: Synced = { changed: [], link: () => undefined };

function fakeApi() {
  return { sendMessage: vi.fn(() => Promise.resolve({ message_id: 1 })) };
}

let file: string;

beforeEach(async () => {
  file = join(await mkdtemp(join(tmpdir(), "group-")), "library.json");
  resetUnavailable();
});

describe("withGroup", () => {
  it("returns undefined without a group and calls nothing", async () => {
    const api = fakeApi();
    const work = vi.fn(() => Promise.resolve(synced));
    expect(await withGroup(api as unknown as Api, work, file)).toBeUndefined();
    expect(work).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("runs the work with the saved state", async () => {
    await saveState({ chatId: -100, topics: {} }, file);
    const work = vi.fn(() => Promise.resolve(synced));
    expect(await withGroup(fakeApi() as unknown as Api, work, file)).toBe(
      synced,
    );
    expect(work).toHaveBeenCalledWith({ chatId: -100, topics: {} });
  });

  it("tells the owner once that the group is unavailable", async () => {
    await saveState({ chatId: -100, topics: {} }, file);
    const api = fakeApi();
    const fail = () => Promise.reject(new Error("bot was kicked"));
    expect(await withGroup(api as unknown as Api, fail, file)).toBeUndefined();
    expect(await withGroup(api as unknown as Api, fail, file)).toBeUndefined();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith(
      7,
      "The library group is unavailable (bot was kicked); sending here.",
    );
    resetUnavailable();
    await withGroup(api as unknown as Api, fail, file);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("hasGroup", () => {
  it("is true only once a group is saved", async () => {
    expect(await hasGroup(file)).toBe(false);
    await saveState({ chatId: -100, topics: {} }, file);
    expect(await hasGroup(file)).toBe(true);
  });
});
