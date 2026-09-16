import { beforeEach, describe, expect, test, vi } from "vitest";

import { FeedsRepo } from "../models/feeds.repo";
import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

describe("Feed Routes", () => {
  test<CustomTestContext>("create feed", async ({ apiCallers }) => {
    const api = apiCallers[0].feeds;
    const newFeed = await api.create({
      name: "Test Feed",
      url: "https://example.com/feed.xml",
      enabled: true,
    });

    expect(newFeed).toBeDefined();
    expect(newFeed.name).toEqual("Test Feed");
    expect(newFeed.url).toEqual("https://example.com/feed.xml");
    expect(newFeed.enabled).toBe(true);
  });

  test<CustomTestContext>("update feed", async ({ apiCallers }) => {
    const api = apiCallers[0].feeds;

    // First, create a feed to update
    const createdFeed = await api.create({
      name: "Test Feed",
      url: "https://example.com/feed.xml",
      enabled: true,
    });

    // Update it
    const updatedFeed = await api.update({
      feedId: createdFeed.id,
      name: "Updated Feed",
      url: "https://updated-example.com/feed.xml",
      enabled: false,
    });

    expect(updatedFeed.name).toEqual("Updated Feed");
    expect(updatedFeed.url).toEqual("https://updated-example.com/feed.xml");
    expect(updatedFeed.enabled).toBe(false);

    // Test updating a non-existent feed
    await expect(() =>
      api.update({
        feedId: "non-existent-id",
        name: "Fail",
        url: "https://fail.com",
        enabled: true,
      }),
    ).rejects.toThrow(/Feed not found/);
  });

  test<CustomTestContext>("list feeds", async ({ apiCallers }) => {
    const api = apiCallers[0].feeds;

    // Create a couple of feeds
    await api.create({
      name: "Feed 1",
      url: "https://example1.com/feed.xml",
      enabled: true,
    });
    await api.create({
      name: "Feed 2",
      url: "https://example2.com/feed.xml",
      enabled: true,
    });

    const result = await api.list();
    expect(result.feeds).toBeDefined();
    expect(result.feeds.length).toBeGreaterThanOrEqual(2);
    expect(result.feeds.some((f) => f.name === "Feed 1")).toBe(true);
    expect(result.feeds.some((f) => f.name === "Feed 2")).toBe(true);
  });

  test<CustomTestContext>("delete feed", async ({ apiCallers }) => {
    const api = apiCallers[0].feeds;

    // Create a feed to delete
    const createdFeed = await api.create({
      name: "Test Feed",
      url: "https://example.com/feed.xml",
      enabled: true,
    });

    // Delete it
    await api.delete({ feedId: createdFeed.id });

    // Verify it's deleted
    await expect(() =>
      api.update({
        feedId: createdFeed.id,
        name: "Updated",
        url: "https://updated.com",
        enabled: true,
      }),
    ).rejects.toThrow(/Feed not found/);
  });

  test<CustomTestContext>("delete feed returns not found when the row disappears after ownership check", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0].feeds;
    const createdFeed = await api.create({
      name: "Test Feed",
      url: "https://example.com/feed.xml",
      enabled: true,
    });

    const deleteSpy = vi
      .spyOn(FeedsRepo.prototype, "delete")
      .mockResolvedValueOnce(false);

    await expect(() => api.delete({ feedId: createdFeed.id })).rejects.toThrow(
      /NOT_FOUND/,
    );

    deleteSpy.mockRestore();
  });

  test<CustomTestContext>("privacy for feeds", async ({ apiCallers }) => {
    const user1Feed = await apiCallers[0].feeds.create({
      name: "User 1 Feed",
      url: "https://user1-feed.com/feed.xml",
      enabled: true,
    });
    const user2Feed = await apiCallers[1].feeds.create({
      name: "User 2 Feed",
      url: "https://user2-feed.com/feed.xml",
      enabled: true,
    });

    // User 1 should not access User 2's feed
    await expect(() =>
      apiCallers[0].feeds.delete({ feedId: user2Feed.id }),
    ).rejects.toThrow(/User is not allowed to access resource/);
    await expect(() =>
      apiCallers[0].feeds.update({
        feedId: user2Feed.id,
        name: "Fail",
        url: "https://fail.com",
        enabled: true,
      }),
    ).rejects.toThrow(/User is not allowed to access resource/);

    // List should only show the correct user's feeds
    const user1List = await apiCallers[0].feeds.list();
    expect(user1List.feeds.some((f) => f.id === user1Feed.id)).toBe(true);
    expect(user1List.feeds.some((f) => f.id === user2Feed.id)).toBe(false);
  });

  test<CustomTestContext>("import feeds from OPML", async ({ apiCallers }) => {
    const api = apiCallers[0].feeds;

    // Pre-existing feed that the OPML also lists - should be skipped as a
    // duplicate rather than imported twice.
    await api.create({
      name: "Already Subscribed",
      url: "https://existing.com/feed.xml",
      enabled: true,
    });

    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="Existing" xmlUrl="https://existing.com/feed.xml"/>
    <outline type="rss" text="New Feed" xmlUrl="https://new.com/feed.xml"/>
  </body>
</opml>`;

    const result = await api.importOpml({ opml });

    expect(result.created).toEqual(1);
    expect(result.skippedDuplicate).toEqual(1);
    expect(result.skippedQuota).toEqual(0);
    expect(result.errors).toEqual([]);

    const list = await api.list();
    expect(list.feeds.some((f) => f.url === "https://new.com/feed.xml")).toBe(
      true,
    );
  });

  test<CustomTestContext>("export feeds to OPML", async ({ apiCallers }) => {
    const api = apiCallers[0].feeds;
    await api.create({
      name: "Export Me",
      url: "https://export-me.com/feed.xml",
      enabled: true,
    });

    const { opml } = await api.exportOpml();
    expect(opml).toContain("https://export-me.com/feed.xml");
    expect(opml).toContain("Export Me");
  });

  test<CustomTestContext>("feed limit enforcement", async ({ apiCallers }) => {
    const api = apiCallers[0].feeds;

    // Create 1000 feeds (the maximum)
    for (let i = 0; i < 1000; i++) {
      await api.create({
        name: `Feed ${i}`,
        url: `https://example${i}.com/feed.xml`,
        enabled: true,
      });
    }

    // The 1001st feed should fail
    await expect(() =>
      api.create({
        name: "Feed 1001",
        url: "https://example1001.com/feed.xml",
        enabled: true,
      }),
    ).rejects.toThrow(/Maximum number of RSS feeds \(1000\) reached/);
  });
});
