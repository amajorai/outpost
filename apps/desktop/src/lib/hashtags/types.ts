/**
 * Shapes for the hashtag / keyword research feature (U14).
 *
 * Given a draft's text and a target platform, the suggestions service returns a
 * list of suggested hashtags or keywords, each optionally carrying a reach /
 * competition signal. Signals are optional on purpose: the only path that can
 * produce real numbers is the configured ACP/Claude agent. The local heuristic
 * fallback has no data source, so it omits them entirely rather than fabricating
 * authoritative-looking figures (mirrors `EngagementCounts` in the providers
 * layer, where every count is optional/unknown-safe).
 */

/** What kind of token a suggestion is. */
export type SuggestionKind = "hashtag" | "keyword";

/** A single suggested hashtag or keyword. */
export interface HashtagSuggestion {
  /**
   * The token to insert. For `hashtag` this includes the leading `#`; for
   * `keyword` it is the bare phrase.
   */
  value: string;
  kind: SuggestionKind;
  /**
   * Relative reach signal, when known. 0-100 where higher means broader
   * audience. Only populated when the agent supplies it; absent for the
   * heuristic.
   */
  reach?: number;
  /**
   * Relative competition signal, when known. 0-100 where higher means more
   * crowded / harder to stand out. Only populated when the agent supplies it.
   */
  competition?: number;
}

/** Where a result came from, surfaced to the UI so it can label the source. */
export type SuggestionSource = "agent" | "heuristic";

/** The full result of a suggestion request for one platform + text. */
export interface SuggestionResult {
  platform: string;
  source: SuggestionSource;
  suggestions: HashtagSuggestion[];
}
