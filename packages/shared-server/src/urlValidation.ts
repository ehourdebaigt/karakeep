import dns from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { LRUCache } from "lru-cache";

import serverConfig from "@karakeep/shared/config";

export const DISALLOWED_IP_RANGES = new Set([
  // IPv4 ranges
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "private",
  "reserved",
  "carrierGradeNat",
  // IPv6 ranges
  "uniqueLocal",
  "6to4", // RFC 3056 - IPv6 transition mechanism
  "teredo", // RFC 4380 - IPv6 tunneling
  "benchmarking", // RFC 5180 - benchmarking addresses
  "deprecated", // RFC 3879 - deprecated IPv6 addresses
  "discard", // RFC 6666 - discard-only prefix
]);

// DNS cache with 5 minute TTL and max 1000 entries
const dnsCache = new LRUCache<string, string[]>({
  max: 1000,
  ttl: 5 * 60 * 1000, // 5 minutes in milliseconds
});

export async function resolveHostAddresses(
  hostname: string,
): Promise<string[]> {
  const resolver = new dns.Resolver({
    timeout: serverConfig.crawler.ipValidation.dnsResolverTimeoutSec * 1000,
  });

  const results = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ]);

  const addresses: string[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      addresses.push(...result.value);
    } else {
      const reason = result.reason;
      if (reason instanceof Error) {
        errors.push(reason.message);
      } else {
        errors.push(String(reason));
      }
    }
  }

  if (addresses.length > 0) {
    return addresses;
  }

  const errorMessage =
    errors.length > 0
      ? errors.join("; ")
      : "DNS lookup did not return any A or AAAA records";
  throw new Error(errorMessage);
}

export function isAddressForbidden(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return true;
  }
  const parsed = ipaddr.parse(address);
  if (
    parsed.kind() === "ipv6" &&
    (parsed as ipaddr.IPv6).isIPv4MappedAddress()
  ) {
    const mapped = (parsed as ipaddr.IPv6).toIPv4Address();
    return DISALLOWED_IP_RANGES.has(mapped.range());
  }
  return DISALLOWED_IP_RANGES.has(parsed.range());
}

export type UrlValidationResult =
  | { ok: true; url: URL; resolvedAddresses?: string[] }
  | { ok: false; reason: string };

export function hostnameMatchesAnyPattern(
  hostname: string,
  patterns: string[],
): boolean {
  function hostnameMatchesPattern(hostname: string, pattern: string): boolean {
    if (pattern === ".") {
      return true;
    }

    return (
      pattern === hostname ||
      (pattern.startsWith(".") && hostname.endsWith(pattern)) ||
      hostname.endsWith("." + pattern)
    );
  }

  for (const pattern of patterns) {
    if (hostnameMatchesPattern(hostname, pattern)) {
      return true;
    }
  }
  return false;
}

export function isHostnameAllowedForInternalAccess(hostname: string): boolean {
  if (!serverConfig.allowedInternalHostnames) {
    return false;
  }
  return hostnameMatchesAnyPattern(
    hostname,
    serverConfig.allowedInternalHostnames,
  );
}

export async function validateUrl(
  urlCandidate: string,
  runningInProxyContext: boolean,
): Promise<UrlValidationResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlCandidate);
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid URL "${urlCandidate}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    } as const;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      ok: false,
      reason: `Unsupported protocol for URL: ${parsedUrl.toString()}`,
    } as const;
  }

  const hostname = parsedUrl.hostname;
  if (!hostname) {
    return {
      ok: false,
      reason: `URL ${parsedUrl.toString()} must include a hostname`,
    } as const;
  }

  if (isHostnameAllowedForInternalAccess(hostname)) {
    return { ok: true, url: parsedUrl } as const;
  }

  if (ipaddr.isValid(hostname)) {
    if (isAddressForbidden(hostname)) {
      return {
        ok: false,
        reason: `Refusing to access disallowed IP address ${hostname} (requested via ${parsedUrl.toString()}). You can use CRAWLER_ALLOWED_INTERNAL_HOSTNAMES to allowlist specific hostnames for internal access.`,
      } as const;
    }
    return { ok: true, url: parsedUrl } as const;
  }

  if (runningInProxyContext) {
    // If we're running in a proxy context, we must skip DNS resolution
    // as the DNS resolution will be handled by the proxy
    return { ok: true, url: parsedUrl } as const;
  }

  // Check cache first
  let records = dnsCache.get(hostname);

  if (!records) {
    // Cache miss or expired - perform DNS resolution
    try {
      records = await resolveHostAddresses(hostname);
      dnsCache.set(hostname, records);
    } catch (error) {
      return {
        ok: false,
        reason: `Failed to resolve hostname ${hostname}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      } as const;
    }
  }

  if (!records || records.length === 0) {
    return {
      ok: false,
      reason: `DNS lookup for ${hostname} did not return any addresses (requested via ${parsedUrl.toString()})`,
    } as const;
  }

  for (const record of records) {
    if (isAddressForbidden(record)) {
      return {
        ok: false,
        reason: `Refusing to access disallowed resolved address ${record} for host ${hostname}`,
      } as const;
    }
  }

  return { ok: true, url: parsedUrl, resolvedAddresses: records } as const;
}

/**
 * Builds a socket lookup function from the addresses that validateUrl already
 * checked. Returning one of those addresses directly to the HTTP agent avoids
 * resolving the hostname again between validation and connection (a DNS
 * rebinding/TOCTOU vulnerability).
 */
export function createPinnedLookup(addresses: string[]): LookupFunction {
  // validateUrl already rejects the entire result set if any address is
  // forbidden. Keep the socket boundary defensive as well, so a future caller
  // cannot accidentally pin a connection to an unchecked address.
  const lookupAddresses = addresses
    .filter((address) => !isAddressForbidden(address))
    .map((address) => ({
      address,
      family: ipaddr.parse(address).kind() === "ipv4" ? 4 : 6,
    }));

  return (_hostname, options, callback) => {
    const requestedFamily =
      options.family === 4 || options.family === "IPv4"
        ? 4
        : options.family === 6 || options.family === "IPv6"
          ? 6
          : undefined;
    const matchingAddresses = requestedFamily
      ? lookupAddresses.filter(({ family }) => family === requestedFamily)
      : lookupAddresses;

    if (matchingAddresses.length === 0) {
      const error = new Error(
        requestedFamily
          ? `Validated DNS lookup returned no allowed IPv${requestedFamily} addresses`
          : "Validated DNS lookup returned no allowed addresses",
      ) as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", requestedFamily);
      return;
    }

    if (options.all) {
      callback(null, matchingAddresses);
    } else {
      const selectedAddress = matchingAddresses[0];
      callback(null, selectedAddress.address, selectedAddress.family);
    }
  };
}
