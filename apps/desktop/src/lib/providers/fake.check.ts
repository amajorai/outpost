/**
 * Runnable smoke check for the fake provider. No test runner is configured in
 * this app, so this is a plain script you can run with:
 *
 *   bun apps/desktop/src/lib/providers/fake.check.ts
 *
 * It exercises the two behaviors the acceptance criteria call out: `publish`
 * and `capabilities`. Exits non-zero on the first failed assertion.
 *
 * Imports only `./fake` and `./types`, which are free of any `@tauri-apps`
 * dependency, so it runs outside a Tauri context.
 */

import { FakePlatformProvider } from "./fake";
import type { ProviderAccount } from "./types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main(): Promise<void> {
  const provider = new FakePlatformProvider({
    now: () => 1_700_000_000_000,
    capabilities: {
      // Make x DM-capable to prove the override path works.
      x: {
        publish: true,
        readComments: true,
        readDMs: true,
        sendDM: true,
        readEngagement: true,
        schedule: false,
      },
    },
  });

  const account: ProviderAccount = { id: "acct-1", platform: "x" };

  // capabilities: default vs override
  const xCaps = await provider.capabilities("x");
  assert(xCaps.sendDM === true, "x override should enable sendDM");
  assert(xCaps.schedule === false, "schedule must always be false");

  const blueskyCaps = await provider.capabilities("bluesky");
  assert(blueskyCaps.sendDM === false, "bluesky should use default (no DMs)");
  assert(blueskyCaps.publish === true, "bluesky should publish by default");

  // publish: success path
  const result = await provider.publish({ account, text: "hello world" });
  assert(
    result.ok === true,
    "publish should succeed for a publish-capable platform"
  );
  if (result.ok) {
    assert(result.remoteId.length > 0, "publish should return a remote id");
    assert(provider.posts.has(result.remoteId), "post should be recorded");
  }

  // publish: idempotency
  const first = await provider.publish({
    account,
    text: "dedupe me",
    idempotencyKey: "k1",
  });
  const second = await provider.publish({
    account,
    text: "dedupe me",
    idempotencyKey: "k1",
  });
  assert(
    first.ok && second.ok && first.remoteId === second.remoteId,
    "idempotent publishes should return the same remote id"
  );

  // publish: blocked when capability is off
  const noPublish = new FakePlatformProvider({
    capabilities: {
      reddit: {
        publish: false,
        readComments: false,
        readDMs: false,
        sendDM: false,
        readEngagement: false,
        schedule: false,
      },
    },
  });
  const blocked = await noPublish.publish({
    account: { id: "a", platform: "reddit" },
    text: "nope",
  });
  assert(blocked.ok === false, "publish should fail when not capable");

  // readEngagement: deterministic
  const e1 = await provider.readEngagement({ platform: "x", remoteId: "p1" });
  const e2 = await provider.readEngagement({ platform: "x", remoteId: "p1" });
  assert(
    e1.likes === e2.likes && e1.comments === e2.comments,
    "engagement reads should be deterministic"
  );

  process.stdout.write("fake provider check: OK\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
