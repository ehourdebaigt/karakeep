import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { parseFeed } from "./feedParser";

async function parseFeedItems(xmlData: string) {
  return (await parseFeed(xmlData)).items;
}

describe("parseFeed", () => {
  test("parses TWZ-style RSS items without dropping them", async () => {
    const xmlData = await readFile(
      new URL("./__fixtures__/twz-feed.xml", import.meta.url),
      "utf8",
    );

    const items = await parseFeedItems(xmlData);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      guid: "https://www.twz.com/?p=12345",
      link: "https://www.twz.com/sea/test-article",
      title: "Test TWZ article",
      categories: ["Sea", "News & Features"],
    });
  });

  test("falls back to guid when feeds do not provide an item id", async () => {
    const items = await parseFeedItems(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <link>https://example.com</link>
          <description>Test</description>
          <item>
            <guid isPermaLink="false">guid-1</guid>
            <link>https://example.com/post-1</link>
            <title>Post 1</title>
          </item>
        </channel>
      </rss>
    `);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      guid: "guid-1",
      link: "https://example.com/post-1",
      title: "Post 1",
    });
    expect(items[0].id).toBeUndefined();
  });

  test("captures full content from content:encoded", async () => {
    const items = await parseFeedItems(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Test Feed</title>
          <link>https://example.com</link>
          <description>Test</description>
          <item>
            <guid isPermaLink="false">guid-1</guid>
            <link>https://example.com/post-1</link>
            <title>Post 1</title>
            <content:encoded><![CDATA[<p>Full article body</p>]]></content:encoded>
          </item>
        </channel>
      </rss>
    `);

    expect(items).toHaveLength(1);
    expect(items[0].content).toBe("<p>Full article body</p>");
  });

  test("falls back to the enclosure URL for podcast episodes without a link", async () => {
    const items = await parseFeedItems(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Test Podcast</title>
          <link>https://example.com</link>
          <description>Test</description>
          <item>
            <guid isPermaLink="false">episode-1</guid>
            <title>Episode 1</title>
            <enclosure url="https://example.com/episode-1.mp3" type="audio/mpeg" length="123456" />
          </item>
        </channel>
      </rss>
    `);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      guid: "episode-1",
      link: "https://example.com/episode-1.mp3",
      title: "Episode 1",
    });
  });

  test("uses the enclosure URL as guid when neither guid nor link is present", async () => {
    const items = await parseFeedItems(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Test Podcast</title>
          <link>https://example.com</link>
          <description>Test</description>
          <item>
            <title>Episode 1</title>
            <enclosure url="https://example.com/episode-1.mp3" type="audio/mpeg" length="123456" />
          </item>
        </channel>
      </rss>
    `);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      guid: "https://example.com/episode-1.mp3",
      link: "https://example.com/episode-1.mp3",
    });
  });

  test("flags a feed as a podcast when it declares the itunes namespace", async () => {
    const { isPodcast } = await parseFeed(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Test Podcast</title>
          <link>https://example.com</link>
          <description>Test</description>
          <item>
            <guid isPermaLink="false">episode-1</guid>
            <link>https://example.com/episode-1</link>
            <title>Episode 1</title>
          </item>
        </channel>
      </rss>
    `);

    expect(isPodcast).toBe(true);
  });

  test("flags a feed as a podcast when its items carry audio enclosures, even without the itunes namespace", async () => {
    const { isPodcast } = await parseFeed(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Test Podcast</title>
          <link>https://example.com</link>
          <description>Test</description>
          <item>
            <guid isPermaLink="false">episode-1</guid>
            <title>Episode 1</title>
            <enclosure url="https://example.com/episode-1.mp3" type="audio/mpeg" length="123456" />
          </item>
        </channel>
      </rss>
    `);

    expect(isPodcast).toBe(true);
  });

  test("does not flag a plain blog feed as a podcast", async () => {
    const { isPodcast } = await parseFeed(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <link>https://example.com</link>
          <description>Test</description>
          <item>
            <guid isPermaLink="false">guid-1</guid>
            <link>https://example.com/post-1</link>
            <title>Post 1</title>
          </item>
        </channel>
      </rss>
    `);

    expect(isPodcast).toBe(false);
  });
});
