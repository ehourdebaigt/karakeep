import { db } from "@karakeep/db";
import { assets, AssetTypes } from "@karakeep/db/schema";
import { newAssetId, QuotaService, saveAsset } from "@karakeep/shared-server";
import logger from "@karakeep/shared/logger";

// Skip near-empty <content:encoded>/<description> blocks - not worth an
// asset, and the regular crawler will still fetch the article as a fallback.
const MIN_CONTENT_LENGTH = 200;

/**
 * Stores a feed entry's own HTML content as a pre-crawled archive asset, so
 * it can be passed as `precrawledArchiveId` to `bookmarks.createBookmark`.
 * The existing crawler pipeline then runs it through Readability + DOMPurify
 * exactly as it does for the browser extension's SingleFile captures,
 * without any crawler changes.
 */
export async function storeFeedItemContentAsset(
  html: string | undefined,
  userId: string,
  jobId: string,
): Promise<string | null> {
  if (!html || html.trim().length < MIN_CONTENT_LENGTH) {
    return null;
  }

  const buffer = Buffer.from(html, "utf8");

  let quotaApproved;
  try {
    quotaApproved = await QuotaService.checkStorageQuota(
      db,
      userId,
      buffer.byteLength,
    );
  } catch (e) {
    logger.warn(
      `[feed][${jobId}] Skipping full-content import due to quota: ${e}`,
    );
    return null;
  }

  const assetId = newAssetId();
  await db.insert(assets).values({
    id: assetId,
    assetType: AssetTypes.UNKNOWN,
    bookmarkId: null,
    userId,
    contentType: "text/html",
    size: buffer.byteLength,
    fileName: null,
  });

  await saveAsset({
    userId,
    assetId,
    asset: buffer,
    metadata: { contentType: "text/html", fileName: null },
    quotaApproved,
  });

  return assetId;
}
