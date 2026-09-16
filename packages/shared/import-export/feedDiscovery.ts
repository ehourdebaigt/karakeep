import * as cheerio from "cheerio";

export interface FeedCandidate {
  url: string;
  title?: string;
}

const FEED_LINK_SELECTOR =
  'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]';

export function extractFeedLinksFromHtml(
  html: string,
  baseUrl: string,
): FeedCandidate[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: FeedCandidate[] = [];

  $(FEED_LINK_SELECTOR).each((_index, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href) {
      return;
    }
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    const title = $(el).attr("title")?.trim();
    candidates.push(title ? { url: resolved, title } : { url: resolved });
  });

  return candidates;
}
