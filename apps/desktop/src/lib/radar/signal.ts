/**
 * Radar -> autoresearch signal bridge (U28 feeds U27).
 *
 * Exposes the radar's cached findings as a single research-input string the
 * autoresearch loop can fold into its proposal prompt. This is the explicit
 * "a function the loop can read" the acceptance criterion calls for — kept
 * standalone (not buried in the loop) so any caller can consume the radar signal
 * independently.
 *
 * Reads the cached `trend_signals` (never re-fetches — caching is the radar's
 * job) and formats them with the pure `formatRadarResearchInput`. Returns "" on
 * any read error or when nothing is cached, so absence contributes nothing to a
 * prompt — the "absence is the old default" contract.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { logger } from "@/lib/logger";
import { formatRadarResearchInput } from "@/lib/radar/rank";
import { listTrendSignals } from "@/lib/repos/radar";

/**
 * The radar's cached findings formatted as autoresearch research input, or "" if
 * there is nothing to surface. Never throws.
 */
export async function getRadarResearchInput(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<string> {
  try {
    const signals = await listTrendSignals(workspaceId);
    return formatRadarResearchInput(signals);
  } catch (error) {
    logger.error({ err: error }, "[Radar] Failed to read research input");
    return "";
  }
}
