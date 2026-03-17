export function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatSize(bytes: number | string): string {
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}MB`;
  return `${(n / 1_000).toFixed(0)}KB`;
}

export const PLACEHOLDER_COVER =
  "https://placehold.co/460x215/0d1117/58a6ff?text=No+Cover&font=raleway";

const ORIGIN = import.meta.env.VITE_API_BASE_URL
  ? new URL(import.meta.env.VITE_API_BASE_URL).origin
  : "https://boilerdeck.com";

/** Resolve a server-relative image URL (e.g. /api/covers/...) to a full URL */
export function resolveCoverUrl(url: string | null): string {
  if (!url) return PLACEHOLDER_COVER;
  if (url.startsWith("http")) return url;
  return `${ORIGIN}${url}`;
}
