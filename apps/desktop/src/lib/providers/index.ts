// biome-ignore-all lint/performance/noBarrelFile: intentional single entry point for the providers module (sanctioned by U4 spec)

/**
 * Provider registry / factory.
 *
 * Returns the active `PlatformProvider`, defaulting to the in-memory fake when
 * no Composio API key is configured. This is the one barrel in the providers
 * folder by design — it is the single entry point the rest of the app imports.
 *
 * The active provider is memoized so callers share one instance (and therefore
 * one capability cache namespace). Call `resetActiveProvider()` after the
 * Composio key changes so the next `getActiveProvider()` rebuilds it.
 */

import { clearCapabilityCache } from "./capability-cache";
import { ComposioProvider } from "./composio";
import { FakePlatformProvider } from "./fake";
import type { PlatformProvider } from "./types";

let active: PlatformProvider | null = null;
let pending: Promise<PlatformProvider> | null = null;

async function build(): Promise<PlatformProvider> {
  const composio = await ComposioProvider.fromStoredKey();
  return composio ?? new FakePlatformProvider();
}

/**
 * Get the active provider, building it on first use. Composio when a key is
 * set, otherwise the fake. Concurrent callers share the same in-flight build.
 */
export function getActiveProvider(): Promise<PlatformProvider> {
  if (active) {
    return Promise.resolve(active);
  }
  if (!pending) {
    pending = build().then((provider) => {
      active = provider;
      pending = null;
      return provider;
    });
  }
  return pending;
}

/**
 * Forget the memoized provider and its cached capabilities. The next
 * `getActiveProvider()` re-resolves from secure storage. Call this whenever the
 * Composio API key is stored or removed.
 */
export function resetActiveProvider(): void {
  if (active) {
    clearCapabilityCache(active.id);
  }
  active = null;
  pending = null;
}

export {
  clearCapabilityCache,
  getCapabilities,
  getCapabilityMatrix,
} from "./capability-cache";
export {
  COMPOSIO_API_KEY_NAME,
  ComposioProvider,
  getComposioApiKey,
  hasComposioApiKey,
  removeComposioApiKey,
  storeComposioApiKey,
} from "./composio";
export { FakePlatformProvider } from "./fake";
export type {
  CapabilityMatrix,
  EngagementCounts,
  Platform,
  PlatformCapabilities,
  PlatformProvider,
  ProviderAccount,
  PublishMedia,
  PublishResult,
  PublishTarget,
  RemotePostRef,
} from "./types";
export { buildMatrix, emptyCapabilities, PLATFORMS } from "./types";
