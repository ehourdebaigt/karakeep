import * as cheerio from "cheerio";

export interface OpmlFeedEntry {
  title: string;
  url: string;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function parseOpmlFeeds(opmlText: string): OpmlFeedEntry[] {
  const $ = cheerio.load(opmlText, { xmlMode: true });
  const entries: OpmlFeedEntry[] = [];

  $("outline[xmlUrl]").each((_index, el) => {
    const $el = $(el);
    const url = $el.attr("xmlUrl")?.trim();
    if (!url || !isValidUrl(url)) {
      return;
    }
    const title = $el.attr("title")?.trim() || $el.attr("text")?.trim() || url;
    entries.push({ title, url });
  });

  return entries;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateOpml(feeds: { name: string; url: string }[]): string {
  const outlines = feeds
    .map(
      (feed) =>
        `    <outline type="rss" text="${escapeXmlAttr(feed.name)}" title="${escapeXmlAttr(feed.name)}" xmlUrl="${escapeXmlAttr(feed.url)}"/>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Karakeep Feeds</title>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}
