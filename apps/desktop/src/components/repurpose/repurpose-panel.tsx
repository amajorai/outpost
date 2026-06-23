/**
 * The Repurpose section's main panel (U17).
 *
 * Paste or import a long-form source (a YouTube transcript, blog post, or
 * podcast text), pick the platforms to repurpose for, then "Atomize". The
 * configured ACP/Claude agent mines the source into many short, platform-native
 * posts plus a list of clip ideas, conditioned on the learned voice profile and
 * each platform's limits (see `lib/repurpose/atomize.ts`).
 *
 * Generated posts are reviewable: open one in the composer (replacing the current
 * draft and selecting its platform's accounts) or batch-add all of them to the
 * drafts queue for later review. The atomize service never throws; failures
 * surface as a sonner toast and the input is preserved.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Textarea } from "@repo/ui/textarea";
import { FileUp, Loader2, ScrollText, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import { getPlatformLimits } from "@/lib/compose/platform-limits";
import {
  type AtomizedPost,
  atomizeFailureMessage,
  atomizeLongForm,
} from "@/lib/repurpose/atomize";
import { useComposerStore } from "@/stores/use-composer-store";
import { useIntegrationStore } from "@/stores/use-integration-store";
import { useNavigationStore } from "@/stores/use-navigation-store";

/** Plain-text MIME prefixes the file import accepts. */
const TEXT_FILE_ACCEPT = ".txt,.md,.srt,.vtt,text/plain,text/markdown";

/** A short one-line summary of an atomized post for the result list. */
function postSummary(post: AtomizedPost): string {
  const first = post.segments[0]?.text ?? "";
  if (first.length <= 120) {
    return first;
  }
  return `${first.slice(0, 120)}...`;
}

export function RepurposePanel() {
  const { label, description } = getSectionMeta("repurpose");

  const accounts = useComposerStore((s) => s.accounts);
  const loadAccounts = useComposerStore((s) => s.loadAccounts);
  const loadAtomizedPost = useComposerStore((s) => s.loadAtomizedPost);
  const batchAddAtomizedToDrafts = useComposerStore(
    (s) => s.batchAddAtomizedToDrafts
  );

  const capabilityMatrix = useIntegrationStore((s) => s.capabilityMatrix);
  const refreshIntegration = useIntegrationStore((s) => s.refresh);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);

  const [source, setSource] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isAtomizing, setIsAtomizing] = useState(false);
  const [posts, setPosts] = useState<AtomizedPost[]>([]);
  const [clipIdeas, setClipIdeas] = useState<string[]>([]);

  useEffect(() => {
    loadAccounts();
    refreshIntegration();
  }, [loadAccounts, refreshIntegration]);

  // The distinct platforms the user has connected accounts for. We only offer
  // these as targets so generated posts can resolve to real accounts on review.
  const connectedPlatforms = useMemo(
    () => [...new Set(accounts.map((account) => account.platform))],
    [accounts]
  );

  // Default to every connected platform once accounts arrive, but never clobber
  // a selection the user has already adjusted.
  useEffect(() => {
    setSelectedPlatforms((current) =>
      current.length === 0 ? connectedPlatforms : current
    );
  }, [connectedPlatforms]);

  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((current) =>
      current.includes(platform)
        ? current.filter((p) => p !== platform)
        : [...current, platform]
    );
  }, []);

  const handleImport = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so re-importing the same file fires `onChange` again.
      event.target.value = "";
      if (!file) {
        return;
      }
      file
        .text()
        .then((content) => setSource(content))
        .catch(() => toast("Could not read that file."));
    },
    []
  );

  const canAtomize =
    source.trim().length > 0 && selectedPlatforms.length > 0 && !isAtomizing;

  const handleAtomize = useCallback(async () => {
    setIsAtomizing(true);
    try {
      const result = await atomizeLongForm(
        source,
        selectedPlatforms,
        capabilityMatrix
      );
      setPosts(result.posts);
      setClipIdeas(result.clipIdeas);
      if (result.failure) {
        toast(atomizeFailureMessage(result.failure));
        return;
      }
      toast(
        `Generated ${result.posts.length} ${
          result.posts.length === 1 ? "post" : "posts"
        } across ${selectedPlatforms.length} ${
          selectedPlatforms.length === 1 ? "platform" : "platforms"
        }.`
      );
    } finally {
      setIsAtomizing(false);
    }
  }, [source, selectedPlatforms, capabilityMatrix]);

  const handleOpenInComposer = useCallback(
    async (post: AtomizedPost) => {
      await loadAtomizedPost(post);
      await setActiveSection("compose");
    },
    [loadAtomizedPost, setActiveSection]
  );

  const handleBatchAdd = useCallback(async () => {
    const saved = await batchAddAtomizedToDrafts(posts);
    toast(
      saved > 0
        ? `Added ${saved} ${saved === 1 ? "draft" : "drafts"} to the queue.`
        : "Could not add drafts to the queue."
    );
  }, [batchAddAtomizedToDrafts, posts]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </header>

        {/* Source input */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm">Long-form source</span>
            <Button
              className="relative"
              size="sm"
              type="button"
              variant="ghost"
            >
              <FileUp className="size-4" />
              Import text
              <input
                accept={TEXT_FILE_ACCEPT}
                aria-label="Import a text file"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={handleImport}
                type="file"
              />
            </Button>
          </div>
          <Textarea
            aria-label="Long-form source text"
            onChange={(e) => setSource(e.target.value)}
            placeholder="Paste a YouTube transcript, blog post, or podcast transcript..."
            rows={10}
            value={source}
          />
          <span className="text-muted-foreground text-xs">
            {source.trim().length.toLocaleString()} characters
          </span>
        </div>

        {/* Platform picker */}
        <div className="flex flex-col gap-2">
          <span className="font-medium text-sm">Repurpose for</span>
          {connectedPlatforms.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Connect an account in Settings to choose target platforms.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {connectedPlatforms.map((platform) => {
                const checked = selectedPlatforms.includes(platform);
                const inputId = `repurpose-platform-${platform}`;
                return (
                  <li key={platform}>
                    <label
                      className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                      htmlFor={inputId}
                    >
                      <Checkbox
                        checked={checked}
                        id={inputId}
                        onCheckedChange={() => togglePlatform(platform)}
                      />
                      {platformLabel(platform)}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <Button disabled={!canAtomize} onClick={handleAtomize} type="button">
            {isAtomizing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Atomize
          </Button>
        </div>

        {/* Clip ideas */}
        {clipIdeas.length > 0 && (
          <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
            <span className="flex items-center gap-2 font-medium text-sm">
              <ScrollText className="size-4 text-muted-foreground" />
              Clip ideas
            </span>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {clipIdeas.map((idea, index) => (
                <li
                  className="text-muted-foreground text-sm"
                  key={`${index}-${idea.slice(0, 24)}`}
                >
                  {idea}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Generated posts */}
        {posts.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-sm">
                Generated posts ({posts.length})
              </span>
              <Button
                onClick={handleBatchAdd}
                size="sm"
                type="button"
                variant="outline"
              >
                Add all to queue
              </Button>
            </div>
            <ul className="flex flex-col gap-2">
              {posts.map((post, index) => {
                const limit = getPlatformLimits(post.platform).maxChars;
                const longest = Math.max(
                  ...post.segments.map((segment) => segment.text.length)
                );
                const over = longest > limit;
                return (
                  <li
                    className="flex flex-col gap-2 rounded-2xl border bg-card p-4"
                    key={`${post.platform}-${index}-${postSummary(post).slice(0, 16)}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {platformLabel(post.platform)}
                        </Badge>
                        {post.segments.length > 1 && (
                          <span className="text-muted-foreground text-xs">
                            {post.segments.length} segments
                          </span>
                        )}
                        <span
                          className={
                            over
                              ? "text-destructive text-xs"
                              : "text-muted-foreground text-xs"
                          }
                        >
                          {longest.toLocaleString()}/{limit.toLocaleString()}
                        </span>
                      </div>
                      <Button
                        onClick={() => handleOpenInComposer(post)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open in composer
                      </Button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {post.segments.map((segment, segmentIndex) => (
                        <p
                          className="whitespace-pre-wrap text-sm"
                          key={`${segmentIndex}-${segment.text.slice(0, 16)}`}
                        >
                          {segment.text}
                        </p>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
