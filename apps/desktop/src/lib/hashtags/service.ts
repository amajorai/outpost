/**
 * Hashtag / keyword suggestions service (U14).
 *
 * The single entry point the composer UI calls. Orchestrates the three pieces:
 *   1. Serve from the in-memory cache on a hit.
 *   2. Prefer the configured ACP/Claude agent for context-aware suggestions
 *      with reach/competition signal.
 *   3. Degrade to the local heuristic when no agent is configured or the agent
 *      fails / returns nothing usable.
 *
 * Always resolves a `SuggestionResult` (never throws to the caller); an empty
 * `suggestions` array is a valid "nothing to suggest" answer.
 */

import { agentSuggestions } from "./agent";
import { getCachedSuggestions, setCachedSuggestions } from "./cache";
import { heuristicSuggestions } from "./heuristic";
import type { SuggestionResult } from "./types";

/**
 * Resolve suggestions for a platform + draft text. Uses the cache, then the
 * agent, then the heuristic. The result is cached (including heuristic results)
 * so repeat requests for the same draft are instant.
 */
export async function getSuggestions(
  platform: string,
  text: string
): Promise<SuggestionResult> {
  const cached = getCachedSuggestions(platform, text);
  if (cached) {
    return cached;
  }

  const fromAgent = await agentSuggestions(platform, text);
  const result: SuggestionResult = fromAgent
    ? { platform, source: "agent", suggestions: fromAgent }
    : {
        platform,
        source: "heuristic",
        suggestions: heuristicSuggestions(platform, text),
      };

  setCachedSuggestions(text, result);
  return result;
}
