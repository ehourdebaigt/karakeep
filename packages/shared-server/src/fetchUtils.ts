import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { HeadersInit, Response } from "node-fetch";
import { Headers } from "node-fetch";

import { createPinnedLookup } from "./urlValidation";

// Shared low-level fetch plumbing used by both the SSRF-safe, proxy-free
// fetchSafely (this package, for trpc/user-initiated requests) and the
// proxy-aware fetchWithProxy (apps/workers/network.ts, for worker jobs) -
// kept in one place so a fix to redirect/header/DNS-pinning handling
// applies to both call sites.

export function cloneHeaders(init?: HeadersInit): Headers {
  const headers = new Headers();
  if (!init) {
    return headers;
  }
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      headers.set(key, value);
    });
    return headers;
  }

  if (Array.isArray(init)) {
    for (const [key, value] of init) {
      headers.append(key, value);
    }
    return headers;
  }

  for (const [key, value] of Object.entries(init)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
}

export function isRedirectResponse(response: Response): boolean {
  return (
    response.status === 301 ||
    response.status === 302 ||
    response.status === 303 ||
    response.status === 307 ||
    response.status === 308
  );
}

export function closeResponseBody(response: Response): void {
  const body: unknown = response.body;
  if (!body) {
    return;
  }

  if (body instanceof Readable) {
    body.destroy();
  } else if (
    typeof ReadableStream !== "undefined" &&
    body instanceof ReadableStream
  ) {
    void body.cancel();
  }
}

export function getPinnedDnsAgent(url: URL, addresses: string[]) {
  const options = { lookup: createPinnedLookup(addresses) };
  return url.protocol === "https:"
    ? new https.Agent(options)
    : new http.Agent(options);
}
