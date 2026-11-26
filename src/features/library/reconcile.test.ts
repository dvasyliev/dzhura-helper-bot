import { describe, expect, it } from "vitest";
import {
  reconcile,
  version,
  type FileItem,
  type Item,
  type Posted,
} from "./reconcile.ts";

const file = (key: string, mtime = 1): FileItem => ({
  key,
  kind: "audio",
  file: `${key}.mp3`,
  size: 10,
  mtime,
});
const a = file("a");
const b = file("b");
const b2 = file("b", 2);
const c = file("c");

let n = 0;
const p = (item: Item): Posted => ({
  key: item.key,
  messageId: ++n,
  kind: item.kind,
  version: version(item),
});

describe("version", () => {
  it("covers text and button data, or size, mtime and caption", () => {
    const text = { key: "t", kind: "text" as const, text: "hi" };
    expect(version({ ...text, button: { text: "x", data: "d" } })).not.toBe(
      version(text),
    );
    expect(version({ ...a, caption: "c" })).toBe("10:1:c");
    expect(version(a)).toBe("10:1:");
    expect(version({ ...a, title: "001. X" })).toBe("10:1:001. X\n");
  });
});

describe("reconcile", () => {
  it("sends what is new at the end", () =>
    expect(reconcile([a, b, c], [p(a), p(b)])).toEqual({ edit: [], cut: 2 }));
  it("edits a changed file in place", () =>
    expect(reconcile([a, b2], [p(a), p(b)])).toEqual({ edit: [1], cut: 2 }));
  it("cuts where the order breaks (chapter 5 voiced after 6)", () =>
    expect(reconcile([a, b, c], [p(a), p(c)])).toEqual({ edit: [], cut: 1 }));
  it("cuts at a removed item", () =>
    expect(reconcile([a, c], [p(a), p(b), p(c)])).toEqual({
      edit: [],
      cut: 1,
    }));
  it("cuts where a photo meets a text message of the same key", () => {
    const text: Item = { key: "contents", kind: "text", text: "hi" };
    const photo: Item = { ...file("contents"), kind: "photo" };
    expect(reconcile([photo], [p(text)])).toEqual({ edit: [], cut: 0 });
  });
  it("changes nothing when all match", () =>
    expect(reconcile([a, b], [p(a), p(b)])).toEqual({ edit: [], cut: 2 }));
});
