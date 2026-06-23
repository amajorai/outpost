/**
 * Provider-agnostic publish pipeline (U10).
 *
 * Consumes due scheduled posts (from the U9 scheduler) and publishes each of
 * their `post_targets` through the right `PlatformProvider`, with per-target
 * retry + backoff and partial-success handling. For every target it writes one
 * terminal `post_history` row and advances the target's status; once the whole
 * fan-out settles it sets the parent post to `published`/`partial`/`failed`.
 *
 * Design: the orchestration is a pure function over an injectable `deps` bag
 * that defaults to the real repos + provider registry. Production wiring uses
 * the defaults; the bun-runnable integration check (pipeline.check.ts) injects
 * in-memory deps + a `FakePlatformProvider`. There is exactly one orchestration
 * path, so the check exercises the same retry/backoff/aggregation logic that
 * ships — only the data layer and clock are swapped.
 *
 * Coverage note: the check does NOT exercise the real `@tauri-apps/plugin-sql`
 * SQL / snake_case mapping (plugin-sql can't load under plain bun). Those repos
 * mirror the established sibling-repo pattern and are covered by `tsc`.
 */

import { logger } from "@/lib/logger";
import type {
  Platform,
  PlatformProvider,
  ProviderAccount,
  PublishMedia,
  PublishResult,
  PublishSegment,
} from "@/lib/providers/types";
import type {
  PostTarget,
  ScheduledPost,
  ScheduledPostStatus,
} from "@/lib/social-schema";

/** Default number of attempts (1 initial + retries) per target. */
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Base backoff delay in ms; doubles each retry (exponential). */
export const DEFAULT_BASE_BACKOFF_MS = 1000;

/** The resolved text + media + account for a single target's publish. */
export interface ResolvedTargetContent {
  text: string;
  media: PublishMedia[];
  account: ProviderAccount;
  /**
   * Ordered segments for a thread/carousel (U12). Always length >= 1 when set,
   * with `segments[0]` mirroring `text`/`media`. Omitted for a single-segment
   * post, in which case the provider only ever sees `text`/`media`.
   */
  segments?: PublishSegment[];
}

/**
 * Everything the pipeline needs from the outside world, injectable so the
 * integration check can swap in-memory fakes for the real DB-backed repos.
 * Production callers use {@link defaultPublishDeps}.
 */
export interface PublishDeps {
  /** Load the targets fanned out from a scheduled post. */
  listPostTargets: (scheduledPostId: string) => Promise<PostTarget[]>;
  /**
   * Resolve a target's publish content (text/media/account). Returns null when
   * the target has no usable body (e.g. no variant override and no draft), so
   * the pipeline can fail it with a clear error instead of posting empty.
   */
  resolveTargetContent: (
    post: ScheduledPost,
    target: PostTarget
  ) => Promise<ResolvedTargetContent | null>;
  /** Resolve the provider responsible for a platform. */
  getProviderFor: (platform: Platform) => Promise<PlatformProvider>;
  /** Persist one terminal history row for a target. */
  recordPostHistory: (input: {
    postTargetId: string;
    status: "published" | "failed";
    remoteUrl?: string | null;
    remoteId?: string | null;
    error?: string | null;
  }) => Promise<unknown>;
  /** Advance a target's status. */
  updatePostTargetStatus: (
    postTargetId: string,
    status: PostTarget["status"]
  ) => Promise<void>;
  /** Advance the parent post's status. */
  updateScheduledPostStatus: (
    scheduledPostId: string,
    status: ScheduledPostStatus
  ) => Promise<void>;
  /** Async sleep, injectable so the check runs with zero delay. */
  sleep: (ms: number) => Promise<void>;
  /** Max attempts per target (1 initial + retries). */
  maxAttempts?: number;
  /** Base backoff in ms; doubled each retry. */
  baseBackoffMs?: number;
}

/** The outcome of publishing one target. */
export interface TargetOutcome {
  targetId: string;
  platform: string;
  status: "published" | "failed";
  remoteUrl: string | null;
  remoteId: string | null;
  error: string | null;
  attempts: number;
}

/** The aggregate outcome of publishing one scheduled post's fan-out. */
export interface PostOutcome {
  postId: string;
  status: Extract<ScheduledPostStatus, "published" | "partial" | "failed">;
  targets: TargetOutcome[];
}

/** Default sleep used by production wiring. */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt a single provider publish, normalizing both the discriminated
 * `{ ok: false }` result and an unexpected thrown error into one shape so the
 * retry loop treats them uniformly.
 */
async function attemptPublish(
  provider: PlatformProvider,
  content: ResolvedTargetContent,
  target: PostTarget
): Promise<PublishResult> {
  try {
    return await provider.publish({
      account: content.account,
      text: content.text,
      media: content.media.length > 0 ? content.media : undefined,
      // Multi-segment content (U12) when the post is a thread/carousel. A
      // single-segment post omits this so unsupported providers just see
      // text/media. Providers that don't understand segments degrade to those.
      segments:
        content.segments && content.segments.length > 1
          ? content.segments
          : undefined,
      // Idempotency key = target id so an in-pipeline retry can't double-post:
      // a provider that honors it returns the prior remote id on the retry.
      idempotencyKey: target.id,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Publish one target with retry + exponential backoff. Writes exactly one
 * terminal `post_history` row (not one per attempt) and advances the target's
 * status. Never throws — returns a {@link TargetOutcome}.
 */
async function publishTarget(
  post: ScheduledPost,
  target: PostTarget,
  deps: PublishDeps
): Promise<TargetOutcome> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  await deps.updatePostTargetStatus(target.id, "publishing");

  const content = await deps.resolveTargetContent(post, target);
  if (!content) {
    const error = "No post body to publish (no variant override and no draft)";
    await deps.recordPostHistory({
      postTargetId: target.id,
      status: "failed",
      error,
    });
    await deps.updatePostTargetStatus(target.id, "failed");
    return {
      targetId: target.id,
      platform: target.platform,
      status: "failed",
      remoteUrl: null,
      remoteId: null,
      error,
      attempts: 0,
    };
  }

  const provider = await deps.getProviderFor(target.platform as Platform);

  let lastError = "Unknown publish error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await attemptPublish(provider, content, target);
    if (result.ok) {
      await deps.recordPostHistory({
        postTargetId: target.id,
        status: "published",
        remoteUrl: result.remoteUrl ?? null,
        remoteId: result.remoteId,
      });
      await deps.updatePostTargetStatus(target.id, "published");
      return {
        targetId: target.id,
        platform: target.platform,
        status: "published",
        remoteUrl: result.remoteUrl ?? null,
        remoteId: result.remoteId,
        error: null,
        attempts: attempt,
      };
    }

    lastError = result.error;
    logger.warn(
      { targetId: target.id, attempt, maxAttempts, error: lastError },
      "[Publish] Target attempt failed"
    );
    if (attempt < maxAttempts) {
      // Exponential backoff: base, base*2, base*4, ...
      await deps.sleep(baseBackoffMs * 2 ** (attempt - 1));
    }
  }

  await deps.recordPostHistory({
    postTargetId: target.id,
    status: "failed",
    error: lastError,
  });
  await deps.updatePostTargetStatus(target.id, "failed");
  return {
    targetId: target.id,
    platform: target.platform,
    status: "failed",
    remoteUrl: null,
    remoteId: null,
    error: lastError,
    attempts: maxAttempts,
  };
}

/** Aggregate per-target outcomes into the parent post's status. */
function aggregateStatus(outcomes: TargetOutcome[]): PostOutcome["status"] {
  const published = outcomes.filter((o) => o.status === "published").length;
  if (published === outcomes.length) {
    return "published";
  }
  if (published === 0) {
    return "failed";
  }
  return "partial";
}

/**
 * Publish a single due scheduled post end-to-end: flip it to `publishing`, fan
 * out to its targets (each with retry/backoff), then set the aggregate status.
 * Targets are published sequentially so backoff sleeps don't stack into a
 * thundering herd; the fan-out per post is small. Never throws.
 */
export async function publishScheduledPost(
  post: ScheduledPost,
  deps: PublishDeps
): Promise<PostOutcome> {
  await deps.updateScheduledPostStatus(post.id, "publishing");

  const targets = await deps.listPostTargets(post.id);
  const outcomes: TargetOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await publishTarget(post, target, deps));
  }

  const status = outcomes.length === 0 ? "failed" : aggregateStatus(outcomes);
  await deps.updateScheduledPostStatus(post.id, status);

  logger.info(
    {
      postId: post.id,
      status,
      published: outcomes.filter((o) => o.status === "published").length,
      total: outcomes.length,
    },
    "[Publish] Scheduled post settled"
  );

  return { postId: post.id, status, targets: outcomes };
}
