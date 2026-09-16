import Parser from "rss-parser";
import { z } from "zod";

const parser = new Parser({
  customFields: {
    // rss-parser only maps <content:encoded> (the full article body some
    // feeds provide) to the bracket-keyed "content:encoded" field by
    // default; alias it to a plain identifier so it's usable from zod/JS.
    item: ["id", ["content:encoded", "contentEncoded"]],
  },
});

const categorySchema = z
  .union([z.string(), z.object({ _: z.string() })])
  .transform((c) => (typeof c === "string" ? c : c._));

const optionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional(),
);

// Podcast episodes: <enclosure url="..." type="audio/mpeg" length="..."/>.
// Some podcast feeds only carry this and omit <link> entirely, so it doubles
// as the item's URL fallback below.
const enclosureSchema = z
  .object({
    url: z.string().optional(),
    type: optionalStringSchema,
  })
  .optional();

const feedItemSchema = z
  .object({
    id: optionalStringSchema,
    link: z.string().optional(),
    guid: z.string().optional(),
    title: z.string().optional(),
    // Atom feeds populate `content` directly with the full entry body; RSS
    // feeds only put the short <description> there and (optionally) the
    // full body in <content:encoded>, aliased below to `contentEncoded`.
    content: optionalStringSchema,
    contentEncoded: optionalStringSchema,
    categories: z.array(categorySchema).optional(),
    enclosure: enclosureSchema,
  })
  .transform(({ contentEncoded, enclosure, ...item }) => ({
    ...item,
    link: item.link ?? enclosure?.url,
    guid: item.guid ?? item.id ?? item.link ?? enclosure?.url,
    content: contentEncoded ?? item.content,
  }));

export type ParsedFeedItem = z.infer<typeof feedItemSchema>;

export interface ParsedFeed {
  items: ParsedFeedItem[];
  // Whether this looks like a podcast feed: it declares the itunes namespace
  // and/or its episodes carry audio/video enclosures.
  isPodcast: boolean;
}

export async function parseFeed(xmlData: string): Promise<ParsedFeed> {
  const unparsedFeedData = await parser.parseString(xmlData);

  const items = unparsedFeedData.items
    .map((item) => feedItemSchema.safeParse(item))
    .flatMap((item) => (item.success ? [item.data] : []));

  const isPodcast =
    !!unparsedFeedData.itunes ||
    unparsedFeedData.items.some((item) => !!item.enclosure?.url);

  return { items, isPodcast };
}
