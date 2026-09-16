import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { fetchSafely, readTextSafely } from "@karakeep/shared-server";
import type { FeedCandidate } from "@karakeep/shared/import-export";
import { extractFeedLinksFromHtml } from "@karakeep/shared/import-export";

const DISCOVERY_TIMEOUT_MS = 5000;
const DISCOVERY_MAX_BYTES = 2 * 1024 * 1024;

const APPLE_PODCASTS_HOSTNAMES = new Set([
  "podcasts.apple.com",
  "itunes.apple.com",
]);

const appleLookupSchema = z.object({
  results: z.array(
    z.object({
      feedUrl: z.string().url().optional(),
      collectionName: z.string().optional(),
    }),
  ),
});

function extractApplePodcastId(url: URL): string | null {
  // Apple Podcasts URLs look like
  // https://podcasts.apple.com/us/podcast/some-show/id1234567890
  const match = /\/id(\d+)/.exec(url.pathname);
  return match ? match[1] : null;
}

async function resolveApplePodcastFeed(
  podcastId: string,
): Promise<FeedCandidate[]> {
  const lookupUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(podcastId)}&entity=podcast`;
  let result: Awaited<ReturnType<typeof fetchSafely>>;
  try {
    result = await fetchSafely(lookupUrl, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: {
        "User-Agent": "Karakeep-RSS/1.0 (+https://karakeep.app)",
        Accept: "application/json",
      },
    });
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Failed to resolve Apple Podcasts feed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (!result.response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Failed to resolve Apple Podcasts feed: received status ${result.response.status}`,
    });
  }

  let body: string;
  try {
    body = await readTextSafely(result.response, DISCOVERY_MAX_BYTES);
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Apple Podcasts lookup returned an invalid response",
    });
  }

  const parsed = appleLookupSchema.safeParse(json);
  if (!parsed.success) {
    return [];
  }
  const feedUrl = parsed.data.results[0]?.feedUrl;
  if (!feedUrl) {
    return [];
  }
  const title = parsed.data.results[0]?.collectionName;
  return [title ? { url: feedUrl, title } : { url: feedUrl }];
}

export async function discoverFeeds(url: string): Promise<FeedCandidate[]> {
  let parsedInputUrl: URL | undefined;
  try {
    parsedInputUrl = new URL(url);
  } catch {
    // Ignore - the generic fetch-and-scan path below will surface the error.
  }

  if (parsedInputUrl && APPLE_PODCASTS_HOSTNAMES.has(parsedInputUrl.hostname)) {
    const podcastId = extractApplePodcastId(parsedInputUrl);
    if (podcastId) {
      const candidates = await resolveApplePodcastFeed(podcastId);
      if (candidates.length > 0) {
        return candidates;
      }
    }
  }

  let result: Awaited<ReturnType<typeof fetchSafely>>;
  try {
    result = await fetchSafely(url, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: {
        "User-Agent": "Karakeep-RSS/1.0 (+https://karakeep.app)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Failed to fetch URL: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  const { response, finalUrl } = result;

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Failed to fetch URL: received status ${response.status}`,
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  let body: string;
  try {
    body = await readTextSafely(response, DISCOVERY_MAX_BYTES);
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (contentType.includes("xml")) {
    // The URL is already a feed - no need to scan for <link> tags.
    return [{ url: finalUrl }];
  }

  return extractFeedLinksFromHtml(body, finalUrl);
}
