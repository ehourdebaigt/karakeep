import { experimental_trpcMiddleware } from "@trpc/server";
import { z } from "zod";

import { FeedQueue } from "@karakeep/shared-server";
import {
  zFeedSchema,
  zNewFeedSchema,
  zUpdateFeedSchema,
} from "@karakeep/shared/types/feeds";

import type { AuthedContext } from "../index";
import { createScopedAuthedProcedure, router } from "../index";
import { actorFromContext } from "../lib/actor";
import { discoverFeeds } from "../lib/feedDiscovery";
import { FeedsService } from "../models/feeds.service";

const feedsProcedure = createScopedAuthedProcedure("feeds").use((opts) => {
  return opts.next({
    ctx: {
      ...opts.ctx,
      actor: actorFromContext(opts.ctx),
      feedsService: new FeedsService(opts.ctx.db),
    },
  });
});

type FeedsContext = AuthedContext & {
  actor: ReturnType<typeof actorFromContext>;
  feedsService: FeedsService;
};

const ensureFeedOwnership = experimental_trpcMiddleware<{
  ctx: FeedsContext;
  input: { feedId: string };
}>().create(async (opts) => {
  const feed = await opts.ctx.feedsService.get(
    opts.ctx.actor,
    opts.input.feedId,
  );

  return opts.next({
    ctx: {
      ...opts.ctx,
      feed,
    },
  });
});

export const feedsAppRouter = router({
  create: feedsProcedure
    .input(zNewFeedSchema)
    .output(zFeedSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.feedsService.create(ctx.actor, input);
    }),
  update: feedsProcedure
    .input(zUpdateFeedSchema)
    .output(zFeedSchema)
    .use(ensureFeedOwnership)
    .mutation(async ({ input, ctx }) => {
      return await ctx.feedsService.update(ctx.feed, input);
    }),
  get: feedsProcedure
    .input(z.object({ feedId: z.string() }))
    .output(zFeedSchema)
    .use(ensureFeedOwnership)
    .query(({ ctx }) => {
      return ctx.feed;
    }),
  list: feedsProcedure
    .output(z.object({ feeds: z.array(zFeedSchema) }))
    .query(async ({ ctx }) => {
      const feeds = await ctx.feedsService.getAll(ctx.actor);
      return { feeds };
    }),
  delete: feedsProcedure
    .input(z.object({ feedId: z.string() }))
    .use(ensureFeedOwnership)
    .mutation(async ({ ctx }) => {
      await ctx.feedsService.delete(ctx.feed);
    }),
  fetchNow: feedsProcedure
    .input(z.object({ feedId: z.string() }))
    .use(ensureFeedOwnership)
    .mutation(async ({ ctx }) => {
      await FeedQueue.enqueue(
        {
          feedId: ctx.feed.id,
        },
        {
          groupId: ctx.user.id,
        },
      );
    }),
  discover: feedsProcedure
    .input(z.object({ url: z.string().max(2000).url() }))
    .output(
      z.object({
        candidates: z.array(
          z.object({ url: z.string(), title: z.string().optional() }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      return { candidates: await discoverFeeds(input.url) };
    }),
  importOpml: feedsProcedure
    .input(z.object({ opml: z.string().max(5_000_000) }))
    .output(
      z.object({
        created: z.number(),
        skippedDuplicate: z.number(),
        skippedQuota: z.number(),
        errors: z.array(z.object({ url: z.string(), error: z.string() })),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.feedsService.importOpml(ctx.actor, input.opml);
    }),
  exportOpml: feedsProcedure
    .output(z.object({ opml: z.string() }))
    .query(async ({ ctx }) => {
      return { opml: await ctx.feedsService.exportOpml(ctx.actor) };
    }),
});
