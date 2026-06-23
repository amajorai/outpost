/**
 * Auto cross-post configuration (U19), persisted in `settings.json` via
 * `@tauri-apps/plugin-store`.
 *
 * The config is a small, single-workspace structure (the app is effectively
 * single-workspace today, so this avoids a SQLite table + migration ceremony):
 *
 * - `enabled`: master switch for the whole feature.
 * - `requireConfirmation`: when true (the default), a detected post is queued
 *   for an explicit review/confirm step before anything is published. This is
 *   the safety guarantee — it posts to real accounts — so the default is ON and
 *   the UI warns prominently when it is turned off.
 * - `routes`: per source-platform -> target-platform enable flags. The source
 *   side is restricted to the platforms the extension can detect
 *   ({@link DETECTABLE_SOURCE_PLATFORMS}); the target side is any supported
 *   platform other than the source itself.
 *
 * Stored under one JSON key so the shape can evolve without touching the
 * settings store's other fields. Read with {@link loadCrossPostConfig}; write
 * with {@link saveCrossPostConfig}.
 */

import { load } from "@tauri-apps/plugin-store";
import { logger } from "@/lib/logger";
import type { Platform } from "@/lib/providers/types";
import { DETECTABLE_SOURCE_PLATFORMS } from "./types";

const SETTINGS_STORE_NAME = "settings.json";
const CROSS_POST_CONFIG_FIELD = "auto_cross_post_config";

/**
 * Map of source platform -> { target platform -> enabled }. A missing entry
 * means "not enabled" so the absence of config never auto-posts anything.
 */
export type CrossPostRoutes = Partial<
  Record<Platform, Partial<Record<Platform, boolean>>>
>;

/** The full persisted cross-post configuration. */
export interface CrossPostConfig {
  /** Master switch. When false, detected posts are ignored entirely. */
  enabled: boolean;
  /**
   * Require an explicit confirm step before publishing. Defaults to true so the
   * pipeline never silently posts to real accounts.
   */
  requireConfirmation: boolean;
  routes: CrossPostRoutes;
}

/** The safe default: feature off, confirmation required, no routes. */
export function defaultCrossPostConfig(): CrossPostConfig {
  return {
    enabled: false,
    requireConfirmation: true,
    routes: {},
  };
}

/** Coerce an unknown persisted value into a valid {@link CrossPostConfig}. */
function coerceConfig(value: unknown): CrossPostConfig {
  const fallback = defaultCrossPostConfig();
  if (typeof value !== "object" || value === null) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const routes =
    typeof record.routes === "object" && record.routes !== null
      ? (record.routes as CrossPostRoutes)
      : {};
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : false,
    // Treat a missing flag as "require confirmation" — the safe default.
    requireConfirmation:
      typeof record.requireConfirmation === "boolean"
        ? record.requireConfirmation
        : true,
    routes,
  };
}

/** Load the persisted cross-post config, falling back to the safe default. */
export async function loadCrossPostConfig(): Promise<CrossPostConfig> {
  try {
    const store = await load(SETTINGS_STORE_NAME, {
      defaults: {},
      autoSave: true,
    });
    const raw = await store.get<CrossPostConfig>(CROSS_POST_CONFIG_FIELD);
    return coerceConfig(raw);
  } catch (err) {
    logger.error({ err }, "[CrossPost] Failed to load config");
    return defaultCrossPostConfig();
  }
}

/** Persist the cross-post config. Throws on failure so callers can surface it. */
export async function saveCrossPostConfig(
  config: CrossPostConfig
): Promise<void> {
  const store = await load(SETTINGS_STORE_NAME, {
    defaults: {},
    autoSave: true,
  });
  await store.set(CROSS_POST_CONFIG_FIELD, config);
  await store.save();
}

/**
 * The target platforms enabled for a given detected source platform. Always
 * excludes the source itself (cross-posting means posting to *other*
 * platforms). Returns an empty array when nothing is configured for the source.
 */
export function enabledTargetsFor(
  config: CrossPostConfig,
  source: Platform
): Platform[] {
  const row = config.routes[source];
  if (!row) {
    return [];
  }
  const targets: Platform[] = [];
  for (const [platform, on] of Object.entries(row)) {
    if (on && platform !== source) {
      targets.push(platform as Platform);
    }
  }
  return targets;
}

/** Whether the source platform is one the extension can actually detect. */
export function isDetectableSource(platform: Platform): boolean {
  return DETECTABLE_SOURCE_PLATFORMS.includes(platform);
}
