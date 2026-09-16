import type { HeadersInit, RequestInit, Response } from "node-fetch";
import fetch from "node-fetch";

import {
  closeResponseBody,
  cloneHeaders,
  getPinnedDnsAgent,
  isRedirectResponse,
} from "./fetchUtils";
import { validateUrl } from "./urlValidation";

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
