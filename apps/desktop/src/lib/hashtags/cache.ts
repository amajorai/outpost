/**
 * In-memory cache for hashtag suggestions (U14).
 *
 * Deliberately in-memory only. Like the provider capability cache, this is a
 * derived, cheaply-refetchable lookup; persisting it would pull it under the
 * Data Versioning Contract (CLAUDE.md) and require a `schemaVersion` + migration
 * for no real benefit. Keyed by `${platform}::${hash(text)}` so the same draft
 * on the same platform serves instantly on repeat requests.
 */

import type { SuggestionResult } from "./types";

const cache = new Map<string, SuggestionResult>();

/**
 * A small, fast, non-cryptographic hash for the cache key. A polynomial rolling
 * hash kept under a 53-bit-safe modulus, so no bitwise ops are needed (which the
 * lint preset prohibits) and the result stays an exact integer.
 */
const HASH_MODULUS = 2_147_483_647;
const HASH_PRIME = 131;

function hashText(text: string): string {
  let hash = 0;
  for (const char of text) {
    hash = (hash * HASH_PRIME + char.charCodeAt(0)) % HASH_MODULUS;
  }
  return hash.toString(36);
}

function keyFor(platform: string, text: string): string {
  return `${platform}::${hashText(text.trim())}`;
}

/** Read a cached result, or undefined on a miss. */
export function getCachedSuggestions(
  platform: string,
  text: string
): SuggestionResult | undefined {
  return cache.get(keyFor(platform, text));
}

/** Store a result for later reads. */
export function setCachedSuggestions(
  text: string,
  result: SuggestionResult
): void {
  cache.set(keyFor(result.platform, text), result);
}

/** Drop all cached suggestions (e.g. when the agent config changes). */
export function clearSuggestionCache(): void {
  cache.clear();
}
