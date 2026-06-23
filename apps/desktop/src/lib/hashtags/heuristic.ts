/**
 * Local heuristic hashtag / keyword suggester (U14).
 *
 * The graceful-degrade path when no ACP/Claude agent is configured (or the agent
 * fails). It extracts salient terms from the draft text by frequency, drops
 * common stopwords, and proposes both bare keywords and `#hashtag` forms. It has
 * no reach/competition data source, so suggestions carry no signal — the UI
 * renders "no signal" rather than inventing numbers.
 *
 * Per-platform tuning is light: hashtag-heavy platforms (Instagram, TikTok) get
 * more hashtag suggestions; text-first platforms (LinkedIn, Reddit, Facebook)
 * lean toward keywords. Unknown platform strings fall through to a sensible
 * default, never throwing — same contract as `getPlatformLimits`.
 */

import type { HashtagSuggestion } from "./types";

/** Tokenizer: words of 3+ letters/digits. Top-level literal (not per-call). */
const WORD_RE = /[a-z0-9]{3,}/gi;

/** Common English stopwords plus social filler that never makes a good tag. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "your",
  "with",
  "this",
  "that",
  "have",
  "has",
  "had",
  "from",
  "they",
  "them",
  "their",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "would",
  "could",
  "should",
  "about",
  "into",
  "over",
  "than",
  "then",
  "there",
  "here",
  "out",
  "our",
  "ours",
  "was",
  "were",
  "been",
  "being",
  "its",
  "it's",
  "all",
  "any",
  "can",
  "get",
  "got",
  "just",
  "like",
  "now",
  "new",
  "one",
  "two",
  "use",
  "via",
  "how",
  "why",
  "his",
  "her",
  "him",
  "she",
  "yourself",
  "myself",
  "very",
  "too",
  "more",
  "most",
  "some",
  "such",
  "only",
  "own",
  "same",
  "much",
  "many",
]);

/** Platforms where hashtags are the dominant discovery mechanism. */
const HASHTAG_HEAVY = new Set(["instagram", "tiktok", "threads", "x"]);

/** Default cap on suggestions returned. */
const MAX_SUGGESTIONS = 8;

/** Turn a single word into a PascalCase-ish hashtag value, with leading `#`. */
function toHashtag(word: string): string {
  return `#${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * Rank candidate terms from `text` by frequency (ties broken by length, longer
 * first — longer words tend to be more specific/topical).
 */
function rankTerms(text: string): string[] {
  const counts = new Map<string, number>();
  const matches = text.toLowerCase().match(WORD_RE) ?? [];
  for (const raw of matches) {
    if (STOPWORDS.has(raw)) {
      continue;
    }
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([term]) => term);
}

/**
 * Produce heuristic suggestions for a platform from the draft text. Returns an
 * empty list when there is nothing useful to extract, which the UI treats as
 * "no suggestions" rather than an error.
 */
export function heuristicSuggestions(
  platform: string,
  text: string
): HashtagSuggestion[] {
  const terms = rankTerms(text);
  if (terms.length === 0) {
    return [];
  }

  const preferHashtags = HASHTAG_HEAVY.has(platform);
  const suggestions: HashtagSuggestion[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    if (suggestions.length >= MAX_SUGGESTIONS) {
      break;
    }
    const value = preferHashtags ? toHashtag(term) : term;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    suggestions.push({
      value,
      kind: preferHashtags ? "hashtag" : "keyword",
    });
  }

  return suggestions;
}
