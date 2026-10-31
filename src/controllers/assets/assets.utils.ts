// Same domain:id shape as products.utils.ts's productCacheKey().
export const assetCacheKey = (key: string): string => `asset:${key}`;

// Only `max-age` matters for this cache — no-cache/no-store/private all
// fall through to "don't cache" by having no positive max-age, which is a
// correct conservative default but doesn't distinguish those three per
// RFC 9111 (see README's own note on this).
export function parseMaxAge(cacheControl: string | undefined): number | null {
  const match = cacheControl?.match(/max-age=(\d+)/);
  const seconds = match ? Number(match[1]) : NaN;

  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
