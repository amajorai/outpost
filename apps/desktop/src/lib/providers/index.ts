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

import { BlueskyProvider } from "./bluesky";
import { clearCapabilityCache } from "./capability-cache";
import { ComposioProvider } from "./composio";
import { FakePlatformProvider } from "./fake";
import type { Platform, PlatformProvider } from "./types";

let active: PlatformProvider | null = null;
let pending: Promise<PlatformProvider> | null = null;

let bluesky: BlueskyProvider | null = null;
let blueskyPending: Promise<BlueskyProvider | null> | null = null;

async function build(): Promise<PlatformProvider> {
  const composio = await ComposioProvider.fromStoredKey();
  return composio ?? new FakePlatformProvider();
}

async function buildBluesky(): Promise<BlueskyProvider | null> {
  return await BlueskyProvider.fromStoredCredentials();
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
 * Get the memoized Bluesky direct provider, or null when no Bluesky
 * credentials are configured. Concurrent callers share the in-flight build.
 */
export function getBlueskyProvider(): Promise<BlueskyProvider | null> {
  if (bluesky) {
    return Promise.resolve(bluesky);
  }
  if (!blueskyPending) {
    blueskyPending = buildBluesky().then((provider) => {
      bluesky = provider;
      blueskyPending = null;
      return provider;
    });
  }
  return blueskyPending;
}

/**
 * Resolve the provider responsible for a given platform.
 *
 * Direct adapters take precedence over the global active provider: a configured
 * Bluesky app password routes `bluesky` targets through `BlueskyProvider`,
 * regardless of whether Composio is also configured. Every other platform falls
 * through to `getActiveProvider()` (Composio when keyed, otherwise the fake).
 *
 * The publish pipeline (U10) and capability lookups should call this with the
 * target's platform so direct adapters are used without any special-casing.
 */
export async function getProviderFor(
  platform: Platform
): Promise<PlatformProvider> {
  if (platform === "bluesky") {
    const direct = await getBlueskyProvider();
    if (direct) {
      return direct;
    }
  }
  return await getActiveProvider();
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

/**
 * Forget the memoized Bluesky provider and its cached capabilities. The next
 * `getBlueskyProvider()` re-resolves from secure storage. Call this whenever the
 * Bluesky credentials are stored or removed.
 */
export function resetBlueskyProvider(): void {
  clearCapabilityCache("bluesky");
  bluesky = null;
  blueskyPending = null;
}

export {
  BLUESKY_APP_PASSWORD_NAME,
  BLUESKY_HANDLE_NAME,
  BlueskyProvider,
  getBlueskyCredentials,
  hasBlueskyCredentials,
  removeBlueskyCredentials,
  storeBlueskyCredentials,
} from "./bluesky";
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
