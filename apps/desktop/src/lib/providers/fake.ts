/**
 * Fully in-memory `PlatformProvider` for tests and local development.
 *
 * Deterministic by construction: no network, no Tauri, no clock-dependent
 * behavior beyond a single injectable `now()`. This file intentionally imports
 * nothing from `@tauri-apps/*` so it can run under plain `bun` in a unit check.
 *
 * - `publish` records the post and returns a stable fake remote id/url.
 * - `readEngagement` returns counts derived deterministically from the post id.
 * - `capabilities` returns a configurable matrix (defaults to "everything
 *   except DMs and schedule", a realistic baseline for most platforms).
 */

import {
  buildMatrix,
  type CapabilityMatrix,
  type EngagementCounts,
  type Platform,
  type PlatformCapabilities,
  type PlatformProvider,
  type ProviderAccount,
  type PublishResult,
  type PublishTarget,
  type RemotePostRef,
} from "./types";

/** A post the fake provider has recorded as published. */
export interface RecordedPost {
  remoteId: string;
  platform: Platform;
  accountId: string;
  text: string;
  mediaCount: number;
  /**
   * Number of segments received (U12). 1 for a single post; > 1 for a
   * thread/carousel. Exposed so the integration check can assert the pipeline
   * forwarded every segment.
   */
  segmentCount: number;
  /** The per-segment text received, in order (length === segmentCount). */
  segmentTexts: string[];
  remoteUrl: string;
  publishedAt: number;
}

export interface FakeProviderOptions {
  /** Override the default capability matrix. */
  capabilities?: Partial<CapabilityMatrix>;
  /** Injectable clock for deterministic timestamps. Defaults to `Date.now`. */
  now?: () => number;
}

const HASH_MULTIPLIER = 31;
const HASH_MODULUS = 2_147_483_647; // 2^31 - 1, keeps values in a safe range

/** Deterministic, non-cryptographic hash of a string to a positive integer. */
function hashString(input: string): number {
  let hash = 0;
  for (const char of input) {
    hash = (hash * HASH_MULTIPLIER + char.charCodeAt(0)) % HASH_MODULUS;
  }
  return hash;
}

/** The baseline capabilities a typical platform supports in the fake. */
function defaultCapabilities(): PlatformCapabilities {
  return {
    publish: true,
    readComments: true,
    readDMs: false,
    sendDM: false,
    readEngagement: true,
    schedule: false,
  };
}

export class FakePlatformProvider implements PlatformProvider {
  readonly id = "fake" as const;

  /** Published posts keyed by remote id, exposed for assertions in tests. */
  readonly posts = new Map<string, RecordedPost>();

  /** Account ids currently connected. */
  readonly connected = new Set<string>();

  private readonly matrix: CapabilityMatrix;
  private readonly now: () => number;
  private sequence = 0;

  constructor(options: FakeProviderOptions = {}) {
    const base = buildMatrix(defaultCapabilities);
    if (options.capabilities) {
      for (const key of Object.keys(options.capabilities) as Platform[]) {
        const override = options.capabilities[key];
        if (override) {
          base[key] = override;
        }
      }
    }
    this.matrix = base;
    this.now = options.now ?? Date.now;
  }

  connect(account: ProviderAccount): Promise<void> {
    this.connected.add(account.id);
    return Promise.resolve();
  }

  disconnect(account: ProviderAccount): Promise<void> {
    this.connected.delete(account.id);
    return Promise.resolve();
  }

  publish(target: PublishTarget): Promise<PublishResult> {
    const caps = this.matrix[target.account.platform];
    if (!caps?.publish) {
      return Promise.resolve({
        ok: false,
        error: `Publishing is not supported for ${target.account.platform}`,
      });
    }

    // Honor idempotency: re-publishing with the same key returns the prior id.
    if (target.idempotencyKey) {
      for (const existing of this.posts.values()) {
        if (existing.remoteId === `fake_${target.idempotencyKey}`) {
          return Promise.resolve({
            ok: true,
            remoteId: existing.remoteId,
            remoteUrl: existing.remoteUrl,
          });
        }
      }
    }

    this.sequence += 1;
    const remoteId =
      target.idempotencyKey != null
        ? `fake_${target.idempotencyKey}`
        : `fake_${target.account.platform}_${this.sequence}`;
    const remoteUrl = `https://fake.local/${target.account.platform}/${remoteId}`;

    // Segments (U12): when present we record each segment's text; otherwise the
    // single post degrades to one segment derived from the top-level text.
    const segments = target.segments ?? [
      { text: target.text, media: target.media },
    ];

    this.posts.set(remoteId, {
      remoteId,
      platform: target.account.platform,
      accountId: target.account.id,
      text: target.text,
      mediaCount: target.media?.length ?? 0,
      segmentCount: segments.length,
      segmentTexts: segments.map((segment) => segment.text),
      remoteUrl,
      publishedAt: this.now(),
    });

    return Promise.resolve({ ok: true, remoteId, remoteUrl });
  }

  readEngagement(ref: RemotePostRef): Promise<EngagementCounts> {
    const seed = hashString(`${ref.platform}:${ref.remoteId}`);
    return Promise.resolve({
      likes: seed % 1000,
      comments: seed % 137,
      shares: seed % 53,
      views: (seed % 1000) * 10,
      fetchedAt: this.now(),
    });
  }

  capabilities(platform: Platform): Promise<PlatformCapabilities> {
    return Promise.resolve(this.matrix[platform]);
  }
}
