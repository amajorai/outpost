/**
 * Hashtag & keyword research panel for the composer (U14).
 *
 * Given the draft's primary text and the platforms of the selected target
 * accounts, fetches per-platform hashtag/keyword suggestions and renders them as
 * one-click insert chips. Suggestions come from the configured ACP/Claude agent
 * when available (with reach/competition signal) and degrade to a local
 * heuristic otherwise. Results are cached by the service, so re-opening the same
 * platform/text is instant.
 *
 * Fetching is explicit (a "Suggest" button), never on keystroke: the agent path
 * spawns a subprocess per request, so firing on every edit would be wasteful.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { Hash, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSuggestions } from "@/lib/hashtags/service";
import type { HashtagSuggestion, SuggestionResult } from "@/lib/hashtags/types";
import { platformLabel } from "./platform-meta";

/** Format a reach/competition signal, or null when the value is absent. */
function signalLabel(suggestion: HashtagSuggestion): string | null {
  const parts: string[] = [];
  if (typeof suggestion.reach === "number") {
    parts.push(`reach ${suggestion.reach}`);
  }
  if (typeof suggestion.competition === "number") {
    parts.push(`competition ${suggestion.competition}`);
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}

export function HashtagSuggestions({
  platforms,
  text,
  onInsert,
}: {
  /** Distinct platforms of the selected target accounts. */
  platforms: string[];
  /** The draft's primary (first-segment) text to research against. */
  text: string;
  /** Insert a suggestion's value into the draft. Caller dedupes. */
  onInsert: (value: string) => void;
}) {
  const [platform, setPlatform] = useState<string>(platforms[0] ?? "");
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Keep the selected platform valid as the target selection changes. When the
  // current platform drops out of the list, fall back to the first available.
  useEffect(() => {
    if (platforms.length === 0) {
      setPlatform("");
      return;
    }
    if (!platforms.includes(platform)) {
      setPlatform(platforms[0]);
    }
  }, [platforms, platform]);

  const handleSuggest = useCallback(async () => {
    if (!platform || text.trim().length === 0) {
      return;
    }
    setIsLoading(true);
    try {
      const next = await getSuggestions(platform, text);
      setResult(next);
    } finally {
      setIsLoading(false);
    }
  }, [platform, text]);

  const canSuggest = platform !== "" && text.trim().length > 0 && !isLoading;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Hash className="size-4 text-muted-foreground" />
          Hashtag & keyword research
        </span>
        <div className="flex items-center gap-2">
          {platforms.length > 1 && (
            <NativeSelect
              aria-label="Research platform"
              onChange={(e) => setPlatform(e.target.value)}
              size="sm"
              value={platform}
            >
              {platforms.map((key) => (
                <NativeSelectOption key={key} value={key}>
                  {platformLabel(key)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <Button
            disabled={!canSuggest}
            onClick={handleSuggest}
            size="sm"
            type="button"
            variant="outline"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Suggest
          </Button>
        </div>
      </div>

      {platforms.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Select a target account to research hashtags for its platform.
        </p>
      )}

      {result && <SuggestionList onInsert={onInsert} result={result} />}
    </section>
  );
}

function SuggestionList({
  result,
  onInsert,
}: {
  result: SuggestionResult;
  onInsert: (value: string) => void;
}) {
  if (result.suggestions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No suggestions yet. Add more detail to your post and try again.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs">
        {result.source === "agent"
          ? "From your AI agent"
          : "Local suggestions (no signal — configure an AI agent for reach data)"}
        {" · "}
        {platformLabel(result.platform)}
      </span>
      <ul className="flex flex-wrap gap-2">
        {result.suggestions.map((suggestion) => {
          const signal = signalLabel(suggestion);
          return (
            <li key={suggestion.value}>
              <Button
                className="h-auto gap-1.5 py-1"
                onClick={() => onInsert(suggestion.value)}
                size="sm"
                type="button"
                variant="outline"
              >
                <span>{suggestion.value}</span>
                {signal && (
                  <Badge className="font-normal" variant="secondary">
                    {signal}
                  </Badge>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
