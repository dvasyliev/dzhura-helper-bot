import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { mockServer } from "./msw.testing.ts";
import { downloadCover, findBook } from "./openlibrary.ts";

const server = mockServer();

describe("findBook", () => {
  it("asks for the title and author with a generic User-Agent", async () => {
    let seen: Request | undefined;
    server.use(
      http.get("https://openlibrary.org/search.json", ({ request }) => {
        seen = request;
        return HttpResponse.json({
          docs: [
            {
              cover_i: 1977228,
              first_publish_year: 2007,
              number_of_pages_median: 96,
            },
          ],
        });
      }),
    );
    expect(await findBook("The Dip", "Seth Godin")).toEqual({
      coverId: 1977228,
      year: 2007,
      pages: 96,
    });
    const url = new URL(seen!.url);
    expect(url.searchParams.get("title")).toBe("The Dip");
    expect(url.searchParams.get("author")).toBe("Seth Godin");
    expect(seen!.headers.get("user-agent")).toBe("dzhura-helper-bot");
  });

  it("returns undefined when nothing matches", async () => {
    server.use(
      http.get("https://openlibrary.org/search.json", () =>
        HttpResponse.json({ docs: [] }),
      ),
    );
    expect(await findBook("Nothing")).toBeUndefined();
  });

  it("throws on a failed request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(
      http.get("https://openlibrary.org/search.json", () =>
        HttpResponse.text("no", { status: 503 }),
      ),
    );
    await expect(findBook("X")).rejects.toThrow("503");
  });
});

describe("downloadCover", () => {
  it("follows the redirect to the image", async () => {
    server.use(
      http.get("https://covers.openlibrary.org/b/id/7-L.jpg", () =>
        HttpResponse.redirect("https://archive.example/7.jpg", 302),
      ),
      http.get("https://archive.example/7.jpg", () =>
        HttpResponse.arrayBuffer(new Uint8Array([9, 8]).buffer),
      ),
    );
    expect(await downloadCover(7)).toEqual(Buffer.from([9, 8]));
  });
});
