import { describe, expect, it, vi } from "vitest";

import { fetchSafely, readTextSafely } from "@karakeep/shared-server";

import { discoverFeeds } from "./feedDiscovery";

vi.mock("@karakeep/shared-server", () => ({
  fetchSafely: vi.fn(),
  readTextSafely: vi.fn(),
}));

const mockedFetchSafely = vi.mocked(fetchSafely);
const mockedReadTextSafely = vi.mocked(readTextSafely);

function mockResponse(
  status: number,
  contentType: string,
): Parameters<typeof mockedFetchSafely.mockResolvedValueOnce>[0] {
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": contentType }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    finalUrl: "https://example.com/",
  };
}

describe("discoverFeeds", () => {
  it("resolves an Apple Podcasts link to its RSS feed via the iTunes lookup API", async () => {
    mockedReadTextSafely.mockResolvedValueOnce(
      JSON.stringify({
        results: [
          {
            feedUrl: "https://example.com/podcast.rss",
            collectionName: "My Cool Podcast",
          },
        ],
      }),
    );
    mockedFetchSafely.mockResolvedValueOnce(
      mockResponse(200, "application/json"),
    );

    const candidates = await discoverFeeds(
      "https://podcasts.apple.com/us/podcast/my-cool-podcast/id1234567890",
    );

    expect(candidates).toEqual([
      { url: "https://example.com/podcast.rss", title: "My Cool Podcast" },
    ]);
    expect(mockedFetchSafely).toHaveBeenCalledWith(
      "https://itunes.apple.com/lookup?id=1234567890&entity=podcast",
      expect.anything(),
    );
  });

  it("falls back to the generic scan when the Apple Podcasts lookup finds nothing", async () => {
    mockedReadTextSafely
      .mockResolvedValueOnce(JSON.stringify({ results: [] }))
      .mockResolvedValueOnce(
        '<link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml">',
      );
    mockedFetchSafely
      .mockResolvedValueOnce(mockResponse(200, "application/json"))
      .mockResolvedValueOnce(mockResponse(200, "text/html"));

    const candidates = await discoverFeeds(
      "https://podcasts.apple.com/us/podcast/my-cool-podcast/id1234567890",
    );

    expect(candidates).toEqual([{ url: "https://example.com/feed.xml" }]);
  });

  it("does not treat non-Apple URLs as podcast links", async () => {
    mockedReadTextSafely.mockResolvedValueOnce(
      '<link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml">',
    );
    mockedFetchSafely.mockResolvedValueOnce(mockResponse(200, "text/html"));

    const candidates = await discoverFeeds("https://example.com/blog");

    expect(mockedFetchSafely).toHaveBeenCalledWith(
      "https://example.com/blog",
      expect.anything(),
    );
    expect(candidates).toEqual([{ url: "https://example.com/feed.xml" }]);
  });
});
