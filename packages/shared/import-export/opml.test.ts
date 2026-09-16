import { describe, expect, it } from "vitest";

import { generateOpml, parseOpmlFeeds } from "./opml";

describe("parseOpmlFeeds", () => {
  it("parses feed entries from an OPML document", () => {
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My Feeds</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Example Blog" title="Example Blog" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com"/>
    </outline>
    <outline type="rss" xmlUrl="https://another.com/rss"/>
  </body>
</opml>`;

    const feeds = parseOpmlFeeds(opml);

    expect(feeds).toHaveLength(2);
    expect(feeds[0]).toEqual({
      title: "Example Blog",
      url: "https://example.com/feed.xml",
    });
    expect(feeds[1]).toEqual({
      title: "https://another.com/rss",
      url: "https://another.com/rss",
    });
  });

  it("drops outlines without a valid xmlUrl", () => {
    const opml = `<opml version="2.0"><body>
      <outline text="No URL"/>
      <outline type="rss" text="Bad URL" xmlUrl="not-a-url"/>
    </body></opml>`;

    expect(parseOpmlFeeds(opml)).toEqual([]);
  });
});

describe("generateOpml", () => {
  it("round-trips through parseOpmlFeeds", () => {
    const feeds = [
      { name: "Feed & Friends", url: "https://example.com/feed.xml" },
      { name: "Another Feed", url: "https://another.com/rss" },
    ];

    const opml = generateOpml(feeds);
    const parsed = parseOpmlFeeds(opml);

    expect(parsed).toEqual([
      { title: "Feed & Friends", url: "https://example.com/feed.xml" },
      { title: "Another Feed", url: "https://another.com/rss" },
    ]);
  });
});
