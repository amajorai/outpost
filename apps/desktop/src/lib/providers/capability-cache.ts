/**
 * In-memory cache of the capability matrix, the runtime source of truth for
 * "is this action available on this platform".
 *
 * The cache is deliberately in-memory only. Persisting it would make it a
 * versioned data surface under the Data Versioning Contract (CLAUDE.md), which
 * is overkill for a derived, cheaply-refetchable lookup. Callers should ask the
 * cache first; on a miss it lazily resolves from the active provider.
 */

import {
  type CapabilityMatrix,
  PLATFORMS,
  type Platform,
  type PlatformCapabilities,
  type PlatformProvider,
} from "./types";

/** Per-provider capability cache. Keyed by provider id so switching providers
 * (e.g. fake -> composio after a key is added) does not serve stale data. */
const cache = new Map<string, Partial<CapabilityMatrix>>();

function cacheFor(provider: PlatformProvider): Partial<CapabilityMatrix> {
  let entry = cache.get(provider.id);
  if (!entry) {
    entry = {};
    cache.set(provider.id, entry);
  }
  return entry;
}

/**
 * Resolve capabilities for one platform, serving from cache when present and
 * populating it on a miss.
 */
export async function getCapabilities(
  provider: PlatformProvider,
  platform: Platform
): Promise<PlatformCapabilities> {
  const entry = cacheFor(provider);
  const cached = entry[platform];
  if (cached) {
    return cached;
  }
  const resolved = await provider.capabilities(platform);
  entry[platform] = resolved;
  return resolved;
}

/** Resolve (and cache) the full matrix across all platforms. */
export async function getCapabilityMatrix(
  provider: PlatformProvider
): Promise<CapabilityMatrix> {
  const matrix = {} as CapabilityMatrix;
  await Promise.all(
    PLATFORMS.map(async (platform) => {
      matrix[platform] = await getCapabilities(provider, platform);
    })
  );
  return matrix;
}

/**
 * Drop cached capabilities. Call after the active provider changes (e.g. the
 * Composio key was added or removed) so the next read reflects reality.
 */
export function clearCapabilityCache(providerId?: string): void {
  if (providerId) {
    cache.delete(providerId);
  } else {
    cache.clear();
  }
}
