import { describe, expect, it } from "vitest";
import { findFolder, folderKey } from "./button.ts";

describe("folderKey", () => {
  it("is stable, short and differs between folders", () => {
    const key = folderKey("Jules Verne - Around the World");
    expect(key).toBe(folderKey("Jules Verne - Around the World"));
    expect(key).toMatch(/^[0-9a-f]{10}$/);
    expect(key).not.toBe(folderKey("Jules Verne - Five Weeks"));
  });
});

describe("findFolder", () => {
  const folders = ["A - One", "Б - Два"];

  it("returns the folder with that key", () => {
    expect(findFolder(folderKey("Б - Два"), folders)).toBe("Б - Два");
  });

  it("is undefined when no folder matches", () => {
    expect(findFolder(folderKey("C - Gone"), folders)).toBeUndefined();
  });
});
