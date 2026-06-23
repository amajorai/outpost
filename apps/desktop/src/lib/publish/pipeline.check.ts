/**
 * Runnable integration check for the publish pipeline (U10). No test runner is
 * configured in this app, so this is a plain script you can run with:
 *
 *   bun apps/desktop/src/lib/publish/pipeline.check.ts
 *
 * It drives the FULL orchestration path end-to-end against an in-memory data
 * layer and a real `FakePlatformProvider`:
 *
 *   schedule (in-memory rows) -> due -> publishScheduledPost -> post_history
 *
 * and asserts the acceptance criteria:
 *   - each target published via provider.publish, with per-target post_history
 *     carrying status + remote url/id
 *   - per-target retry with backoff (a flaky target succeeds on a later attempt)
 *   - partial success handled (one target always-fails -> parent = "partial")
 *   - failure surfaced (history error recorded, parent = "failed")
 *
 * Coverage limitation: this exercises the same orchestration code that ships,
 * but injects in-memory deps instead of the real `@tauri-apps/plugin-sql` repos
 * (plugin-sql can't load under plain bun). The real SQL / snake_case mapping in
 * the repos mirrors the established sibling-repo pattern and is covered by
 * `tsc`. Live posting against a real provider remains a manual gate.
 *
 * Imports only the pipeline core + the fake provider + the in-memory store
 * helpers below, none of which touch `@tauri-apps/*`, so it runs under plain bun.
 */

import { FakePlatformProvider } from "@/lib/providers/fake";
import type { PlatformProvider, PublishResult } from "@/lib/providers/types";
import type {
  PostTarget,
  ScheduledPost,
  ScheduledPostStatus,
} from "@/lib/social-schema";
import {
  type PublishDeps,
  publishScheduledPost,
  type ResolvedTargetContent,
} from "./pipeline";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/** One resolvable segment for a target in the in-memory store. */
interface StoredSegment {
  text: string;
}

/** A minimal in-memory mirror of the DB rows the pipeline touches. */
interface InMemoryStore {
  post: ScheduledPost;
  targets: PostTarget[];
  history: {
    postTargetId: string;
    status: "published" | "failed";
    remoteUrl: string | null;
    remoteId: string | null;
    error: string | null;
  }[];
  bodyByTargetId: Map<string, string>;
  /** Optional multi-segment content per target (U12). */
  segmentsByTargetId: Map<string, StoredSegment[]>;
}

/** Build in-memory deps for a single scheduled post + its targets. */
function makeDeps(
  store: InMemoryStore,
  provider: PlatformProvider,
  overrides: Partial<PublishDeps> = {}
): PublishDeps {
  return {
    listPostTargets: (_id) => Promise.resolve(store.targets),
    resolveTargetContent: (
      _post,
      target
    ): Promise<ResolvedTargetContent | null> => {
      const text = store.bodyByTargetId.get(target.id);
      if (text == null) {
        return Promise.resolve(null);
      }
      const storedSegments = store.segmentsByTargetId.get(target.id);
      const segments = storedSegments?.map((segment) => ({
        text: segment.text,
        media: [],
      }));
      return Promise.resolve({
        text,
        media: [],
        account: {
          id: target.socialAccountId,
          platform: target.platform as never,
        },
        segments,
      });
    },
    getProviderFor: () => Promise.resolve(provider),
    recordPostHistory: (input) => {
      store.history.push({
        postTargetId: input.postTargetId,
        status: input.status,
        remoteUrl: input.remoteUrl ?? null,
        remoteId: input.remoteId ?? null,
        error: input.error ?? null,
      });
      return Promise.resolve(undefined);
    },
    updatePostTargetStatus: (id, status) => {
      const t = store.targets.find((x) => x.id === id);
      if (t) {
        t.status = status;
      }
      return Promise.resolve();
    },
    updateScheduledPostStatus: (_id, status: ScheduledPostStatus) => {
      store.post.status = status;
      return Promise.resolve();
    },
    // Zero delay so the check is fast; we still prove backoff is invoked below.
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

function makeStore(targetCount: number): InMemoryStore {
  const post: ScheduledPost = {
    id: "post-1",
    workspaceId: "default",
    draftId: "draft-1",
    scheduledFor: 0,
    status: "due",
    createdAt: 0,
  };
  const targets: PostTarget[] = [];
  const bodyByTargetId = new Map<string, string>();
  for (let i = 0; i < targetCount; i++) {
    const id = `target-${i}`;
    targets.push({
      id,
      scheduledPostId: post.id,
      socialAccountId: `acct-${i}`,
      platform: "x",
      variantBody: null,
      status: "pending",
    });
    bodyByTargetId.set(id, `hello from target ${i}`);
  }
  return {
    post,
    targets,
    history: [],
    bodyByTargetId,
    segmentsByTargetId: new Map(),
  };
}

async function checkHappyPath(): Promise<void> {
  const store = makeStore(2);
  const provider = new FakePlatformProvider({ now: () => 1_700_000_000_000 });
  const deps = makeDeps(store, provider);

  const outcome = await publishScheduledPost(store.post, deps);

  assert(outcome.status === "published", "all targets ok -> published");
  assert(store.post.status === "published", "parent status persisted");
  assert(store.history.length === 2, "one history row per target");
  for (const row of store.history) {
    assert(row.status === "published", "history row should be published");
    assert(!!row.remoteId, "history should carry a remote id");
    assert(!!row.remoteUrl, "history should carry a remote url");
  }
  for (const target of store.targets) {
    assert(target.status === "published", "target marked published");
  }
}

async function checkRetryThenSucceed(): Promise<void> {
  const store = makeStore(1);
  // A provider that fails the first attempt, then succeeds — proves retry works
  // and that exactly one terminal history row is written (not one per attempt).
  let attempts = 0;
  let backoffCalls = 0;
  const flaky: PlatformProvider = {
    id: "fake",
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    publish: (): Promise<PublishResult> => {
      attempts += 1;
      if (attempts < 2) {
        return Promise.resolve({ ok: false, error: "transient" });
      }
      return Promise.resolve({
        ok: true,
        remoteId: "r1",
        remoteUrl: "https://fake.local/x/r1",
      });
    },
    readEngagement: () => Promise.resolve({ fetchedAt: 0 }),
    capabilities: () =>
      Promise.resolve({
        publish: true,
        readComments: false,
        readDMs: false,
        sendDM: false,
        readEngagement: false,
        schedule: false,
      }),
  };
  const deps = makeDeps(store, flaky, {
    sleep: () => {
      backoffCalls += 1;
      return Promise.resolve();
    },
  });

  const outcome = await publishScheduledPost(store.post, deps);

  assert(attempts === 2, "should retry once then succeed");
  assert(backoffCalls === 1, "backoff sleep invoked between attempts");
  assert(outcome.status === "published", "eventual success -> published");
  assert(store.history.length === 1, "exactly one terminal history row");
  assert(store.history[0].status === "published", "terminal row is published");
}

async function checkThrowIsRetried(): Promise<void> {
  const store = makeStore(1);
  let attempts = 0;
  const thrower: PlatformProvider = {
    id: "fake",
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    publish: (): Promise<PublishResult> => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("boom");
      }
      return Promise.resolve({ ok: true, remoteId: "r2" });
    },
    readEngagement: () => Promise.resolve({ fetchedAt: 0 }),
    capabilities: () =>
      Promise.resolve({
        publish: true,
        readComments: false,
        readDMs: false,
        sendDM: false,
        readEngagement: false,
        schedule: false,
      }),
  };
  const deps = makeDeps(store, thrower);

  const outcome = await publishScheduledPost(store.post, deps);
  assert(attempts === 2, "a thrown error should be retried, not fatal");
  assert(outcome.status === "published", "recovered after a throw");
}

async function checkPartial(): Promise<void> {
  const store = makeStore(2);
  // target-0 succeeds (real fake), target-1 always fails.
  const fake = new FakePlatformProvider();
  const mixed: PlatformProvider = {
    id: "fake",
    connect: (account) => fake.connect(account),
    disconnect: (account) => fake.disconnect(account),
    publish: (target): Promise<PublishResult> => {
      if (target.idempotencyKey === "target-1") {
        return Promise.resolve({ ok: false, error: "always fails" });
      }
      return fake.publish(target);
    },
    readEngagement: (ref) => fake.readEngagement(ref),
    capabilities: (platform) => fake.capabilities(platform),
  };
  const deps = makeDeps(store, mixed);

  const outcome = await publishScheduledPost(store.post, deps);

  assert(outcome.status === "partial", "one ok + one fail -> partial");
  assert(store.post.status === "partial", "parent persisted as partial");
  const failRow = store.history.find((h) => h.postTargetId === "target-1");
  const okRow = store.history.find((h) => h.postTargetId === "target-0");
  assert(!!failRow && failRow.status === "failed", "failed target recorded");
  assert(
    failRow?.error === "always fails",
    "error message surfaced in history"
  );
  assert(!!okRow && okRow.status === "published", "ok target recorded");
}

async function checkAllFail(): Promise<void> {
  const store = makeStore(1);
  const failing: PlatformProvider = {
    id: "fake",
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    publish: (): Promise<PublishResult> =>
      Promise.resolve({ ok: false, error: "down" }),
    readEngagement: () => Promise.resolve({ fetchedAt: 0 }),
    capabilities: () =>
      Promise.resolve({
        publish: true,
        readComments: false,
        readDMs: false,
        sendDM: false,
        readEngagement: false,
        schedule: false,
      }),
  };
  const deps = makeDeps(store, failing, { maxAttempts: 2 });

  const outcome = await publishScheduledPost(store.post, deps);
  assert(outcome.status === "failed", "no targets ok -> failed");
  assert(store.post.status === "failed", "parent persisted as failed");
  assert(outcome.targets[0].attempts === 2, "exhausted the attempt budget");
  assert(store.history[0].error === "down", "final error surfaced");
}

async function checkEmptyBodyFails(): Promise<void> {
  const store = makeStore(1);
  store.bodyByTargetId.clear(); // no resolvable body
  const provider = new FakePlatformProvider();
  const deps = makeDeps(store, provider);

  const outcome = await publishScheduledPost(store.post, deps);
  assert(outcome.status === "failed", "no body -> target fails");
  assert(
    store.history[0].status === "failed",
    "empty-body target recorded as failed"
  );
}

async function checkMultiSegment(): Promise<void> {
  // A thread of 3 segments should reach the provider intact (U12). The fake
  // records segmentCount + per-segment text so we can assert the pipeline
  // forwarded every segment, not just the first.
  const store = makeStore(1);
  const target = store.targets[0];
  store.bodyByTargetId.set(target.id, "tweet one");
  store.segmentsByTargetId.set(target.id, [
    { text: "tweet one" },
    { text: "tweet two" },
    { text: "tweet three" },
  ]);
  const provider = new FakePlatformProvider({ now: () => 1_700_000_000_000 });
  const deps = makeDeps(store, provider);

  const outcome = await publishScheduledPost(store.post, deps);

  assert(outcome.status === "published", "multi-segment post published");
  const recorded = [...provider.posts.values()][0];
  assert(!!recorded, "fake recorded the published post");
  assert(
    recorded.segmentCount === 3,
    `fake should receive 3 segments, got ${recorded.segmentCount}`
  );
  assert(
    recorded.segmentTexts.join("|") === "tweet one|tweet two|tweet three",
    "fake should receive each segment's text in order"
  );
}

async function checkSingleSegmentDegrades(): Promise<void> {
  // A single-segment post must NOT carry a `segments` array to the provider, so
  // unsupported providers see only text/media — the degrade path (U12).
  const store = makeStore(1);
  const target = store.targets[0];
  store.bodyByTargetId.set(target.id, "just one");
  store.segmentsByTargetId.set(target.id, [{ text: "just one" }]);
  const provider = new FakePlatformProvider({ now: () => 1_700_000_000_000 });
  const deps = makeDeps(store, provider);

  await publishScheduledPost(store.post, deps);

  const recorded = [...provider.posts.values()][0];
  assert(recorded.segmentCount === 1, "single segment recorded as one post");
  assert(recorded.text === "just one", "degraded post carries the body text");
}

async function main(): Promise<void> {
  await checkHappyPath();
  await checkRetryThenSucceed();
  await checkThrowIsRetried();
  await checkPartial();
  await checkAllFail();
  await checkEmptyBodyFails();
  await checkMultiSegment();
  await checkSingleSegmentDegrades();
  process.stdout.write("publish pipeline check: OK\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
