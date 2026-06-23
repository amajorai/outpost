/**
 * Detected-post listener for the auto cross-post pipeline (U19).
 *
 * Subscribes to the `detected-post` Tauri event emitted by the hardened local
 * bridge (src-tauri/src/http_bridge.rs) when the U18 extension delivers a post
 * the user authored manually. For each event it:
 *
 * 1. Parses + version-validates the payload (drops anything not `version: 1`).
 * 2. Bails if the feature is disabled or the source platform isn't enabled with
 *    at least one target.
 * 3. Dedupes against the user's own recent scheduled/published posts so a bot
 *    echo or a re-detected cross-post never loops (lib/cross-post/dedupe.ts).
 * 4. Either routes immediately (when confirmation is off) or enqueues for the
 *    review dialog (the default) — never silently posting to real accounts.
 *
 * Lifecycle mirrors the scheduler/runner: a module-level singleton makes
 * `startCrossPostListener()` idempotent under React StrictMode's double-mounted
 * effects, and the listener intentionally stays subscribed for the app lifetime
 * (the hook's cleanup does not unsubscribe). Because `listen()` is async, a
 * `starting` flag guards the window between "start requested" and "subscribed".
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { sileo } from "sileo";
import { logger } from "@/lib/logger";
import type { Platform } from "@/lib/providers/types";
import { useCrossPostStore } from "@/stores/use-cross-post-store";
import { enabledTargetsFor, loadCrossPostConfig } from "./config";
import { isOwnRecentPost, normalizeForCompare } from "./dedupe";
import { routeDetectedPost } from "./route";
import { type DetectedPost, parseDetectedPost } from "./types";

/** The Tauri event the bridge emits per detected manual post. */
const DETECTED_POST_EVENT = "detected-post";

let unlisten: UnlistenFn | null = null;
let starting = false;

/**
 * A short-lived set of normalized text recently accepted for cross-posting. The
 * DB dedupe can't catch two near-simultaneous duplicate detections before the
 * first one's row commits, so this in-memory guard closes that race. Entries
 * expire so a genuinely-new post reusing old wording isn't blocked forever.
 */
const recentlySeen = new Map<string, number>();
const RECENTLY_SEEN_TTL_MS = 60_000;

function rememberSeen(text: string, now: number): void {
  recentlySeen.set(text, now);
}

function wasRecentlySeen(text: string, now: number): boolean {
  for (const [key, at] of recentlySeen) {
    if (now - at > RECENTLY_SEEN_TTL_MS) {
      recentlySeen.delete(key);
    }
  }
  return recentlySeen.has(text);
}

/** Publish a confirmed post immediately (confirmation disabled path). */
async function autoRoute(
  detected: DetectedPost,
  targetPlatforms: Platform[]
): Promise<void> {
  const result = await routeDetectedPost(detected, targetPlatforms);
  if (result.targetCount > 0) {
    sileo.success({
      title: "Cross-posting your post",
      description: `Routing to ${result.targetCount} target${result.targetCount === 1 ? "" : "s"}`,
    } as Parameters<typeof sileo.success>[0]);
  }
}

/** Handle one validated detected post end-to-end. Never throws. */
async function handleDetected(detected: DetectedPost): Promise<void> {
  const config = await loadCrossPostConfig();
  if (!config.enabled) {
    return;
  }

  const targetPlatforms = enabledTargetsFor(config, detected.platform);
  if (targetPlatforms.length === 0) {
    return;
  }

  const now = Date.now();
  const normalized = normalizeForCompare(detected.text);
  if (normalized.length > 0 && wasRecentlySeen(normalized, now)) {
    return;
  }

  const dedupe = await isOwnRecentPost(detected, now);
  if (dedupe.isDuplicate) {
    logger.info(
      { reason: dedupe.reason, source: detected.platform },
      "[CrossPost] Skipped own/echoed post"
    );
    return;
  }

  if (normalized.length > 0) {
    rememberSeen(normalized, now);
  }

  if (config.requireConfirmation) {
    useCrossPostStore.getState().enqueue({
      id: crypto.randomUUID(),
      detected,
      targetPlatforms,
    });
    return;
  }

  await autoRoute(detected, targetPlatforms);
}

/**
 * Start listening for `detected-post` events. Idempotent (singleton) so a second
 * call while running — or while a first call's async `listen()` is still in
 * flight — is a no-op, making it safe under StrictMode. Returns the stop fn.
 */
export async function startCrossPostListener(): Promise<() => void> {
  if (unlisten || starting) {
    return stopCrossPostListener;
  }
  starting = true;

  logger.info("[CrossPost] Starting detected-post listener");

  try {
    unlisten = await listen<unknown>(DETECTED_POST_EVENT, (event) => {
      const detected = parseDetectedPost(event.payload);
      if (!detected) {
        logger.warn(
          { payload: event.payload },
          "[CrossPost] Dropped malformed detected-post payload"
        );
        return;
      }
      handleDetected(detected).catch((err) => {
        logger.error({ err }, "[CrossPost] Failed to handle detected post");
      });
    });
  } finally {
    starting = false;
  }

  return stopCrossPostListener;
}

/** Stop the listener. Idempotent. */
export function stopCrossPostListener(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
    logger.info("[CrossPost] Stopped detected-post listener");
  }
}

/** Whether the listener is currently subscribed. */
export function isCrossPostListenerRunning(): boolean {
  return unlisten !== null;
}
