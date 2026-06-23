/**
 * Publish runner (U10) — bridges the U9 scheduler to the publish pipeline.
 *
 * Subscribes to the scheduler's `onDue` stream AND drains `getDuePosts()` on
 * start, because the scheduler's launch catch-up sweep can flip posts to `due`
 * before this runner subscribes. Both paths funnel through one guarded handler:
 *
 * - An in-flight `Set` keyed by post id dedupes the onDue/drain overlap and any
 *   re-drain, so a post is never published twice concurrently.
 * - Each due post is immediately moved off `due` (the pipeline flips it to
 *   `publishing`), so a subsequent `getDuePosts()` can't re-pick it.
 * - A module-level singleton makes `startPublishRunner()` idempotent under React
 *   StrictMode's double-mounted effects, mirroring the scheduler.
 *
 * Known limitation (out of scope): flipping `due -> publishing` means a crash
 * mid-publish orphans the post, since `getDuePosts()` only returns `due` rows.
 * Crash recovery for in-flight publishes is a future unit.
 *
 * `onDue` is a synchronous `(posts) => void`; our handler is async, so we catch
 * rejections inside rather than letting a promise float out of the listener.
 */

import { sileo } from "sileo";
import { logger } from "@/lib/logger";
import { defaultPublishDeps } from "@/lib/publish/deps";
import { type PublishDeps, publishScheduledPost } from "@/lib/publish/pipeline";
import { getDuePosts, onDue } from "@/lib/scheduler/scheduler";
import type { ScheduledPost } from "@/lib/social-schema";
import { usePublishQueueStore } from "@/stores/use-publish-queue-store";

let unsubscribe: (() => void) | null = null;
const inFlight = new Set<string>();

/** Fire a result toast for a settled post. */
function notifySettled(
  status: "published" | "partial" | "failed",
  published: number,
  total: number
): void {
  if (status === "published") {
    sileo.success({
      title: "Post published",
      description: `${published}/${total} target${total === 1 ? "" : "s"} published`,
    } as Parameters<typeof sileo.success>[0]);
    return;
  }
  if (status === "partial") {
    sileo.error({
      title: "Post partially published",
      description: `${published}/${total} targets published; the rest failed`,
    } as Parameters<typeof sileo.error>[0]);
    return;
  }
  sileo.error({
    title: "Post failed to publish",
    description: `0/${total} targets published`,
  } as Parameters<typeof sileo.error>[0]);
}

/** Publish one due post through the pipeline, guarded against double-runs. */
async function handleDuePost(
  post: ScheduledPost,
  deps: PublishDeps
): Promise<void> {
  if (inFlight.has(post.id)) {
    return;
  }
  inFlight.add(post.id);
  usePublishQueueStore.getState().start(post.id);
  try {
    const outcome = await publishScheduledPost(post, deps);
    usePublishQueueStore.getState().settle(outcome);
    const published = outcome.targets.filter(
      (t) => t.status === "published"
    ).length;
    notifySettled(outcome.status, published, outcome.targets.length);
  } catch (err) {
    // publishScheduledPost is designed not to throw; this is a belt-and-braces
    // guard so a runner-level failure never crashes the scheduler listener.
    logger.error({ err, postId: post.id }, "[Publish] Runner failed for post");
    usePublishQueueStore.getState().settle({
      postId: post.id,
      status: "failed",
      targets: [],
    });
  } finally {
    inFlight.delete(post.id);
  }
}

/** Process a batch of due posts sequentially. */
async function handleDueBatch(
  posts: ScheduledPost[],
  deps: PublishDeps
): Promise<void> {
  for (const post of posts) {
    await handleDuePost(post, deps);
  }
}

/**
 * Start the publish runner. Idempotent (singleton) so a second call while
 * running is a no-op — safe under StrictMode. Subscribes to `onDue` and drains
 * any already-`due` posts the scheduler's catch-up sweep produced before we
 * subscribed. Returns the stop function.
 *
 * `deps` defaults to the real DB-backed wiring; the integration check passes a
 * fake `deps` to drive the same path in-memory.
 */
export function startPublishRunner(
  deps: PublishDeps = defaultPublishDeps()
): () => void {
  if (unsubscribe) {
    return stopPublishRunner;
  }

  logger.info("[Publish] Starting publish runner");

  unsubscribe = onDue((posts) => {
    handleDueBatch(posts, deps).catch((err) => {
      logger.error({ err }, "[Publish] onDue batch failed");
    });
  });

  // Drain posts that became due before we subscribed (launch catch-up sweep).
  getDuePosts()
    .then((posts) => handleDueBatch(posts, deps))
    .catch((err) => {
      logger.error({ err }, "[Publish] Initial due drain failed");
    });

  return stopPublishRunner;
}

/** Stop the publish runner. Idempotent. */
export function stopPublishRunner(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    logger.info("[Publish] Stopped publish runner");
  }
}

/** Whether the runner is currently subscribed. */
export function isPublishRunnerRunning(): boolean {
  return unsubscribe !== null;
}
