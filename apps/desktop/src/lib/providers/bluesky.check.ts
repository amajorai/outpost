/**
 * Runnable smoke check for the Bluesky provider. No test runner is configured in
 * this app, so this is a plain script you can run with:
 *
 *   bun apps/desktop/src/lib/providers/bluesky.check.ts
 *
 * It stubs `globalThis.fetch` so no real network is hit, then exercises the
 * acceptance-criteria behaviors: session creation from the app password,
 * publish via createRecord (remoteId == at-uri), readEngagement mapping
 * (likes/repost/reply), and the capability set. Exits non-zero on first failure.
 *
 * `@tauri-apps/api/core` is mocked via a module stub on the import map is not
 * available under plain bun, so this check avoids importing the provider's
 * secure-storage helpers and constructs `BlueskyProvider` directly with creds.
 */

import { BlueskyProvider } from "./bluesky";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/** Minimal unsigned JWT with a far-future exp, good enough for expiry parsing. */
function fakeJwt(): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
  );
  return `${header}.${payload}.`;
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

async function main(): Promise<void> {
  const calls: FetchCall[] = [];
  const accessJwt = fakeJwt();

  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    const json = (body: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(""),
      } as Response);

    if (url.includes("com.atproto.server.createSession")) {
      return json({
        accessJwt,
        refreshJwt: fakeJwt(),
        did: "did:plc:test",
        handle: "alice.bsky.social",
      });
    }
    if (url.includes("com.atproto.repo.createRecord")) {
      return json({
        uri: "at://did:plc:test/app.bsky.feed.post/abc123",
        cid: "bafytest",
      });
    }
    if (url.includes("app.bsky.feed.getPosts")) {
      return json({
        posts: [
          {
            uri: "at://did:plc:test/app.bsky.feed.post/abc123",
            likeCount: 12,
            repostCount: 3,
            replyCount: 5,
          },
        ],
      });
    }
    return json({});
  }) as typeof fetch;

  const provider = new BlueskyProvider({
    handle: "alice.bsky.social",
    appPassword: "test-app-pass",
  });

  // capabilities: bluesky publishes + reads engagement, no DMs, no schedule.
  const caps = await provider.capabilities("bluesky");
  assert(caps.publish === true, "bluesky should publish");
  assert(caps.readEngagement === true, "bluesky should read engagement");
  assert(caps.sendDM === false, "bluesky should not send DMs");
  assert(caps.schedule === false, "schedule must always be false");

  const otherCaps = await provider.capabilities("x");
  assert(
    otherCaps.publish === false,
    "non-bluesky platforms are unsupported by the bluesky adapter"
  );

  // publish: returns the at-uri as remoteId and a bsky.app URL.
  const result = await provider.publish({
    account: { id: "a", platform: "bluesky" },
    text: "hello from outpost",
  });
  assert(result.ok === true, "text publish should succeed");
  if (result.ok) {
    assert(
      result.remoteId === "at://did:plc:test/app.bsky.feed.post/abc123",
      "remoteId should be the at-uri"
    );
    assert(
      result.remoteUrl ===
        "https://bsky.app/profile/alice.bsky.social/post/abc123",
      "remoteUrl should be the bsky.app permalink"
    );
  }

  // createSession should have been called exactly once for both ops (memoized).
  const sessionCalls = calls.filter((c) =>
    c.url.includes("createSession")
  ).length;
  assert(sessionCalls === 1, "session should be created once and reused");

  // readEngagement: maps likeCount/replyCount/repostCount -> likes/comments/shares.
  const engagement = await provider.readEngagement({
    platform: "bluesky",
    remoteId: "at://did:plc:test/app.bsky.feed.post/abc123",
  });
  assert(engagement.likes === 12, "likes should map from likeCount");
  assert(engagement.comments === 5, "comments should map from replyCount");
  assert(engagement.shares === 3, "shares should map from repostCount");

  process.stdout.write("bluesky provider check: OK\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
