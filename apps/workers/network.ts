import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { HeadersInit, RequestInit, Response } from "node-fetch";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch, { Headers } from "node-fetch";

import {
  createPinnedLookup,
  hostnameMatchesAnyPattern,
  validateUrl,
} from "@karakeep/shared-server";
import type { UrlValidationResult } from "@karakeep/shared-server";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";

export { createPinnedLookup, hostnameMatchesAnyPattern, validateUrl };
export type { UrlValidationResult };

export function getBookmarkDomain(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function getPinnedDnsAgent(url: URL, addresses: string[]) {
  const options = { lookup: createPinnedLookup(addresses) };
  return url.protocol === "https:"
    ? new https.Agent(options)
    : new http.Agent(options);
}

export function getRandomProxy(proxyList: string[]): string {
  return proxyList[Math.floor(Math.random() * proxyList.length)].trim();
}

export function matchesNoProxy(url: string, noProxy: string[]) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    return hostnameMatchesAnyPattern(hostname, noProxy);
  } catch (e) {
    logger.error(`Failed to parse URL: ${url}: ${e}`);
    return false;
  }
}

/**
 * Pre-selected proxy URLs to use consistently across a single crawler run.
 * Created once at the start of a run via `selectRunProxies()`.
 */
export interface RunProxyConfig {
  httpProxy: string | undefined;
  httpsProxy: string | undefined;
  noProxy: string[] | undefined;
}

/**
 * Selects a random proxy from each configured proxy list, to be used
 * consistently for the duration of a single crawler run.
 */
export function selectRunProxies(): RunProxyConfig {
  const { proxy } = serverConfig;
  return {
    httpProxy: proxy.httpProxy ? getRandomProxy(proxy.httpProxy) : undefined,
    httpsProxy: proxy.httpsProxy ? getRandomProxy(proxy.httpsProxy) : undefined,
    noProxy: proxy.noProxy,
  };
}

export function getProxyAgent(url: string, runProxy?: RunProxyConfig) {
  const httpProxy = runProxy
    ? runProxy.httpProxy
    : serverConfig.proxy.httpProxy
      ? getRandomProxy(serverConfig.proxy.httpProxy)
      : undefined;
  const httpsProxy = runProxy
    ? runProxy.httpsProxy
    : serverConfig.proxy.httpsProxy
      ? getRandomProxy(serverConfig.proxy.httpsProxy)
      : undefined;
  const noProxy = runProxy ? runProxy.noProxy : serverConfig.proxy.noProxy;

  if (!httpProxy && !httpsProxy) {
    return undefined;
  }

  const urlObj = new URL(url);
  const protocol = urlObj.protocol;

  // Check if URL should bypass proxy
  if (noProxy && matchesNoProxy(url, noProxy)) {
    return undefined;
  }

  if (protocol === "https:" && httpsProxy) {
    return new HttpsProxyAgent(httpsProxy);
  } else if (protocol === "http:" && httpProxy) {
    return new HttpProxyAgent(httpProxy);
  } else if (httpProxy) {
    return new HttpProxyAgent(httpProxy);
  }

  return undefined;
}

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

export type FetchWithProxyOptions = Omit<
  RequestInit & {
    maxRedirects?: number;
  },
  "agent"
>;

interface PreparedFetchOptions {
  maxRedirects: number;
  baseHeaders: Headers;
  method: string;
  body?: RequestInit["body"];
  baseOptions: RequestInit;
}

export function prepareFetchOptions(
  options: FetchWithProxyOptions = {},
): PreparedFetchOptions {
  const {
    maxRedirects = 5,
    headers: initHeaders,
    method: initMethod,
    body: initBody,
    redirect: _ignoredRedirect,
    ...restOptions
  } = options;

  const baseOptions = restOptions as RequestInit;

  return {
    maxRedirects,
    baseHeaders: cloneHeaders(initHeaders),
    method: initMethod?.toUpperCase?.() ?? "GET",
    body: initBody,
    baseOptions,
  };
}

interface BuildFetchOptionsInput {
  method: string;
  body?: RequestInit["body"];
  headers: Headers;
  agent?: RequestInit["agent"];
  baseOptions: RequestInit;
}

export function buildFetchOptions({
  method,
  body,
  headers,
  agent,
  baseOptions,
}: BuildFetchOptionsInput): RequestInit {
  return {
    ...baseOptions,
    method,
    body,
    headers,
    agent,
    redirect: "manual",
  };
}

export const fetchWithProxy = async (
  url: string,
  options: FetchWithProxyOptions = {},
  runProxy?: RunProxyConfig,
) => {
  const {
    maxRedirects,
    baseHeaders,
    method: preparedMethod,
    body: preparedBody,
    baseOptions,
  } = prepareFetchOptions(options);

  let redirectsRemaining = maxRedirects;
  let currentUrl = url;
  let currentMethod = preparedMethod;
  let currentBody = preparedBody;

  while (true) {
    const proxyAgent = getProxyAgent(currentUrl, runProxy);

    const validation = await validateUrl(currentUrl, !!proxyAgent);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }
    const requestUrl = validation.url;
    currentUrl = requestUrl.toString();
    const agent =
      proxyAgent ??
      (validation.resolvedAddresses
        ? getPinnedDnsAgent(requestUrl, validation.resolvedAddresses)
        : undefined);

    const response = await fetch(
      currentUrl,
      buildFetchOptions({
        method: currentMethod,
        body: currentBody,
        headers: baseHeaders,
        agent,
        baseOptions,
      }),
    );

    if (!isRedirectResponse(response)) {
      return response;
    }

    const locationHeader = response.headers.get("location");
    if (!locationHeader) {
      return response;
    }

    closeResponseBody(response);

    if (redirectsRemaining <= 0) {
      throw new Error(`Too many redirects while fetching ${url}`);
    }

    const nextUrl = new URL(locationHeader, currentUrl);

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        currentMethod !== "GET" &&
        currentMethod !== "HEAD")
    ) {
      currentMethod = "GET";
      currentBody = undefined;
      baseHeaders.delete("content-length");
    }

    currentUrl = nextUrl.toString();
    redirectsRemaining -= 1;
  }
};

export async function resolveValidatedRedirectUrl(
  url: string,
  options: Pick<
    FetchWithProxyOptions,
    "headers" | "maxRedirects" | "signal"
  > = {},
  runProxy?: RunProxyConfig,
): Promise<URL> {
  const { maxRedirects, baseHeaders, baseOptions } = prepareFetchOptions({
    ...options,
    method: "GET",
  });

  let redirectsRemaining = maxRedirects;
  let currentUrl = url;

  while (true) {
    const signal = options.signal
      ? AbortSignal.any([
          AbortSignal.timeout(5000),
          options.signal as globalThis.AbortSignal,
        ])
      : AbortSignal.timeout(5000);
    const proxyAgent = getProxyAgent(currentUrl, runProxy);
    const validation = await validateUrl(currentUrl, !!proxyAgent);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }

    const requestUrl = validation.url;
    currentUrl = requestUrl.toString();
    const agent =
      proxyAgent ??
      (validation.resolvedAddresses
        ? getPinnedDnsAgent(requestUrl, validation.resolvedAddresses)
        : undefined);

    const response = await fetch(
      currentUrl,
      buildFetchOptions({
        method: "GET",
        headers: baseHeaders,
        agent,
        baseOptions: {
          ...baseOptions,
          signal: signal as RequestInit["signal"],
        },
      }),
    );

    if (!isRedirectResponse(response)) {
      closeResponseBody(response);
      return requestUrl;
    }

    closeResponseBody(response);

    const locationHeader = response.headers.get("location");
    if (!locationHeader) {
      return requestUrl;
    }

    if (redirectsRemaining <= 0) {
      throw new Error(`Too many redirects while resolving ${url}`);
    }

    currentUrl = new URL(locationHeader, currentUrl).toString();
    redirectsRemaining -= 1;
  }
}
