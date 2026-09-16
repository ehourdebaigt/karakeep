import { describe, expect, it } from "vitest";

import { extractFeedLinksFromHtml } from "./feedDiscovery";

describe("extractFeedLinksFromHtml", () => {
  it("finds rss and atom alternate links and resolves relative URLs", () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/feed.xml">
          <link rel="alternate" type="application/atom+xml" title="Atom Feed" href="https://example.com/atom.xml">
          <link rel="stylesheet" href="/style.css">
        </head>
        <body></body>
      </html>
    `;

    const candidates = extractFeedLinksFromHtml(
      html,
      "https://example.com/blog/post",
    );

    expect(candidates).toEqual([
      { url: "https://example.com/feed.xml", title: "RSS Feed" },
      { url: "https://example.com/atom.xml", title: "Atom Feed" },
    ]);
  });

  it("returns an empty array when no feed links are present", () => {
    const html = "<html><head><title>No feeds here</title></head></html>";
    expect(extractFeedLinksFromHtml(html, "https://example.com")).toEqual([]);
  });

  it("dedupes identical resolved URLs", () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
    `;
    expect(extractFeedLinksFromHtml(html, "https://example.com/")).toHaveLength(
      1,
    );
  });
});
