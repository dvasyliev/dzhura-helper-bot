import { describe, expect, it } from "vitest";
import { youtubeId } from "./link.ts";

describe("youtubeId", () => {
  it("finds the video id in YouTube links of every shape", () => {
    expect(
      youtubeId(
        "https://www.youtube.com/watch?v=SDVOzznI2zk&list=PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&index=10",
      ),
    ).toBe("SDVOzznI2zk");
    expect(youtubeId("глянь https://youtu.be/B0bnhONb2kM?si=x")).toBe(
      "B0bnhONb2kM",
    );
    expect(youtubeId("https://youtube.com/shorts/l2cwhjJXxCA")).toBe(
      "l2cwhjJXxCA",
    );
    expect(youtubeId("https://music.youtube.com/watch?v=B0bnhONb2kM")).toBe(
      "B0bnhONb2kM",
    );
  });

  it("ignores text without a link", () => {
    expect(youtubeId("Дюна Герберт")).toBeUndefined();
  });
});
