import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { DB } from "@karakeep/db";
import type { rssFeedsTable } from "@karakeep/db/schema";
import serverConfig from "@karakeep/shared/config";
import { generateOpml, parseOpmlFeeds } from "@karakeep/shared/import-export";
import {
  MAX_FEED_NAME_LENGTH,
  MAX_FEED_URL_LENGTH,
  zNewFeedSchema,
  zUpdateFeedSchema,
} from "@karakeep/shared/types/feeds";

import type { Actor, Authorized } from "../lib/actor";
import { actorUserId, assertOwnership, authorize } from "../lib/actor";
import { FeedsRepo } from "./feeds.repo";

type Feed = typeof rssFeedsTable.$inferSelect;

export class FeedsService {
  private repo: FeedsRepo;

  constructor(db: DB) {
    this.repo = new FeedsRepo(db);
  }

  async get(actor: Actor, id: string): Promise<Authorized<Feed>> {
    const feed = await this.repo.get(id);
    if (!feed) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Feed not found",
      });
    }
    return authorize(feed, () => assertOwnership(actor, feed.userId));
  }

  async create(
    actor: Actor,
    input: z.infer<typeof zNewFeedSchema>,
  ): Promise<Feed> {
    const userId = actorUserId(actor);
    const feedCount = await this.repo.countByUser(userId);
    const maxFeeds = serverConfig.feeds.maxRssFeedsPerUser;
    if (feedCount >= maxFeeds) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Maximum number of RSS feeds (${maxFeeds}) reached`,
      });
    }

    return await this.repo.create(userId, input);
  }

  async update(
    feed: Authorized<Feed>,
    input: z.infer<typeof zUpdateFeedSchema>,
  ): Promise<Feed> {
    const updated = await this.repo.update(feed.id, input);
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return updated;
  }

  async getAll(actor: Actor): Promise<Feed[]> {
    return await this.repo.getAll(actorUserId(actor));
  }

  async delete(feed: Authorized<Feed>): Promise<void> {
    const deleted = await this.repo.delete(feed.id);
    if (!deleted) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
  }

  async importOpml(
    actor: Actor,
    opmlText: string,
  ): Promise<{
    created: number;
    skippedDuplicate: number;
    skippedQuota: number;
    errors: { url: string; error: string }[];
  }> {
    const userId = actorUserId(actor);
    const entries = parseOpmlFeeds(opmlText);
    const existingUrls = new Set(
      (await this.repo.getAll(userId)).map((f) => f.url),
    );
    const maxFeeds = serverConfig.feeds.maxRssFeedsPerUser;
    let currentCount = await this.repo.countByUser(userId);

    const result = {
      created: 0,
      skippedDuplicate: 0,
      skippedQuota: 0,
      errors: [] as { url: string; error: string }[],
    };

    for (const entry of entries) {
      if (entry.url.length > MAX_FEED_URL_LENGTH) {
        result.errors.push({ url: entry.url, error: "URL is too long" });
        continue;
      }
      if (existingUrls.has(entry.url)) {
        result.skippedDuplicate++;
        continue;
      }
      if (currentCount >= maxFeeds) {
        result.skippedQuota++;
        continue;
      }
      try {
        await this.repo.create(userId, {
          name: entry.title.slice(0, MAX_FEED_NAME_LENGTH),
          url: entry.url,
          enabled: true,
          importTags: false,
          importFullContent: false,
        });
        existingUrls.add(entry.url);
        currentCount++;
        result.created++;
      } catch (e) {
        result.errors.push({
          url: entry.url,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return result;
  }

  async exportOpml(actor: Actor): Promise<string> {
    const feeds = await this.repo.getAll(actorUserId(actor));
    return generateOpml(feeds.map((f) => ({ name: f.name, url: f.url })));
  }
}
