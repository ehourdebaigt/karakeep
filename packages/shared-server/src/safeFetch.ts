import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { HeadersInit, RequestInit, Response } from "node-fetch";
import fetch, { Headers } from "node-fetch";

import { createPinnedLookup, validateUrl } from "./urlValidation";

function cloneHeaders(init?: HeadersInit): Headers {
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

function isRedirectResponse(response: Response): boolean {
  return (
    response.status === 301 ||
    response.status === 302 ||
    response.status === 303 ||
    response.status === 307 ||
    response.status === 308
  );
}

function closeResponseBody(response: Response): void {
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

function getPinnedDnsAgent(url: URL, addresses: string[]) {
  const options = { lookup: createPinnedLookup(addresses) };
  return url.protocol === "https:"
    ? new https.Agent(options)
    : new http.Agent(options);
}

export interface FetchSafelyOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
  maxRedirects?: number;
}

/**
 * A proxy-free, SSRF-safe fetch for user-supplied URLs called directly from a
 * server request handler (e.g. tRPC), rather than from a worker job. Every
 * hop (including redirects) is validated via `validateUrl` and the
 * connection is pinned to the already-validated addresses to avoid a
 * DNS-rebinding TOCTOU. Does not support the operator-configured HTTP(S)
 * proxy that worker-initiated fetches (`fetchWithProxy` in `apps/workers`)
 * use - acceptable for the current callers, which are one-shot,
 * user-initiated, low-volume requests.
 */
export async function fetchSafely(
  url: string,
  options: FetchSafelyOptions = {},
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? 5;
  const baseHeaders = cloneHeaders(options.headers);

  let redirectsRemaining = maxRedirects;
  let currentUrl = url;

  while (true) {
    const validation = await validateUrl(currentUrl, false);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }
    const requestUrl = validation.url;
    currentUrl = requestUrl.toString();
    const agent = validation.resolvedAddresses
      ? getPinnedDnsAgent(requestUrl, validation.resolvedAddresses)
      : undefined;

    const response = await fetch(currentUrl, {
      method: "GET",
      headers: baseHeaders,
      agent,
      redirect: "manual",
      signal: options.signal as RequestInit["signal"],
    });

    if (!isRedirectResponse(response)) {
      return { response, finalUrl: currentUrl };
    }

    const locationHeader = response.headers.get("location");
    if (!locationHeader) {
      return { response, finalUrl: currentUrl };
    }

    closeResponseBody(response);

    if (redirectsRemaining <= 0) {
      throw new Error(`Too many redirects while fetching ${url}`);
    }

    currentUrl = new URL(locationHeader, currentUrl).toString();
    redirectsRemaining -= 1;
  }
}

/**
 * Reads a fetch response body as text, aborting once `maxBytes` is exceeded
 * instead of buffering an unbounded response from an untrusted server.
 */
export async function readTextSafely(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body) {
    return "";
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of body as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      closeResponseBody(response);
      throw new Error(
        `Response body exceeded the maximum allowed size of ${maxBytes} bytes`,
      );
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
