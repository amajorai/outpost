/**
 * Typed client for the Outpost companion API (U34).
 *
 * Talks to apps/server's `/api/companion/*` routes — the realistic sync point
 * between the local-first desktop and this phone. Every request is authenticated
 * by forwarding the better-auth session cookie that the Expo client stores.
 *
 * IMPORTANT (the cookie seam): the @better-auth/expo plugin only auto-attaches
 * the session cookie to `authClient`'s own methods, NOT to arbitrary `fetch`
 * calls. So we pull `authClient.getCookie()` and set it as the `Cookie` header
 * on every request here, with `credentials: "omit"` so it isn't clobbered. Skip
 * this and every call silently 401s.
 */

import { env } from "@outpost/env/native";

import { authClient } from "@/lib/auth-client";

const BASE = env.EXPO_PUBLIC_SERVER_URL;

export type ApprovalKind = "autopilot" | "experiment";

export interface CompanionApproval {
  id: string;
  sourceId: string;
  kind: ApprovalKind;
  title: string;
  body: string;
  rationale: string;
  targetPlatform: string;
  scheduledFor: number | null;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export interface CompanionPost {
  id: string;
  body: string;
  platforms: string[];
  scheduledFor: number | null;
  status: string;
  createdAt: number;
}

export type ApprovalDecision = "approved" | "rejected";

function authedHeaders(extra?: Record<string, string>): Record<string, string> {
  const cookie = authClient.getCookie();
  return {
    "Content-Type": "application/json",
    Cookie: cookie,
    ...extra,
  };
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    throw new Error("Your session expired. Please sign in again.");
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok) {
    const message =
      typeof (payload as { error?: unknown })?.error === "string"
        ? (payload as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload as T;
}

/** GET the signed-in user's pending approval actions. */
export async function listApprovals(): Promise<CompanionApproval[]> {
  const res = await fetch(`${BASE}/api/companion/approvals`, {
    method: "GET",
    headers: authedHeaders(),
    credentials: "omit",
  });
  const data = await parseJsonOrThrow<{ items: CompanionApproval[] }>(res);
  return data.items;
}

/** Approve or reject a pending action by its server id. */
export async function decideApproval(
  id: string,
  decision: ApprovalDecision
): Promise<void> {
  const res = await fetch(
    `${BASE}/api/companion/approvals/${encodeURIComponent(id)}/decision`,
    {
      method: "POST",
      headers: authedHeaders(),
      credentials: "omit",
      body: JSON.stringify({ decision }),
    }
  );
  await parseJsonOrThrow<{ success: boolean }>(res);
}

/** Compose a post from the phone; queued for the desktop to publish. */
export async function createPost(input: {
  body: string;
  platforms: string[];
  scheduledFor?: number | null;
}): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/companion/posts`, {
    method: "POST",
    headers: authedHeaders(),
    credentials: "omit",
    body: JSON.stringify({
      body: input.body,
      platforms: input.platforms,
      scheduledFor: input.scheduledFor ?? null,
    }),
  });
  return await parseJsonOrThrow<{ id: string }>(res);
}

/** List the signed-in user's phone-composed posts. */
export async function listPosts(): Promise<CompanionPost[]> {
  const res = await fetch(`${BASE}/api/companion/posts`, {
    method: "GET",
    headers: authedHeaders(),
    credentials: "omit",
  });
  const data = await parseJsonOrThrow<{ items: CompanionPost[] }>(res);
  return data.items;
}

/** Register this device's Expo push token with the server. */
export async function registerPushToken(
  token: string,
  platform: "ios" | "android" | "web"
): Promise<void> {
  const res = await fetch(`${BASE}/api/companion/push-token`, {
    method: "POST",
    headers: authedHeaders(),
    credentials: "omit",
    body: JSON.stringify({ token, platform }),
  });
  await parseJsonOrThrow<{ success: boolean }>(res);
}
