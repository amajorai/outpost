/**
 * Companion router (U34) — the server-side sync point for the Expo mobile app.
 *
 * The desktop app is local-first: autopilot/experiment approval actions (U30)
 * live in the desktop's local SQLite. The phone can't read that directly, so
 * this router is the realistic sync channel between the two. It persists the
 * minimum needed for a creator to triage from their phone:
 *
 *   - `companion_approvals`  — pending autopilot/experiment actions awaiting a
 *                              decision, keyed by the better-auth `userId`.
 *   - `companion_posts`      — posts composed from the phone, queued for the
 *                              desktop to actually publish through its provider
 *                              pipeline.
 *   - `companion_push_tokens`— Expo push tokens registered per user/device.
 *
 * Every record is keyed by the authenticated `userId` (the desktop is
 * workspace-scoped locally; the server has no notion of workspaces, so the user
 * is the unit of isolation here). Auth is enforced via the better-auth session
 * cookie forwarded by the Expo client.
 *
 * WHAT IS REAL vs FOLLOW-UP:
 *   - REAL: every endpoint below is auth'd and end-to-end against MongoDB. The
 *     mobile app reads/writes through them for real.
 *   - REAL seam: `POST /approvals` is a genuine, auth'd push endpoint. The
 *     desktop is meant to call it to publish its locally-proposed actions.
 *   - FOLLOW-UP: the desktop does not yet (a) hold a better-auth session to
 *     authenticate as the user, (b) push its local autopilot_actions here, or
 *     (c) write a decision made on the phone back into its local SQLite. Those
 *     are the genuinely large local-first<->cloud reconciliation pieces and are
 *     tracked as follow-ups, not faked here.
 *   - FOLLOW-UP: actually SENDING an Expo push (via Expo's push service) when an
 *     approval is created — the token is stored here; the send call is the
 *     documented server-side follow-up.
 */

import { auth } from "@outpost/auth";
import { client } from "@outpost/db";
import { Hono } from "hono";
import mongoose from "mongoose";
import { z } from "zod";

const { ObjectId } = mongoose.mongo;

interface SessionUser {
  id: string;
}

/** Resolve the authenticated user from the better-auth session, or null. */
async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return null;
  }
  return { id: session.user.id };
}

const approvalKindSchema = z.enum(["autopilot", "experiment"]);

const createApprovalSchema = z.object({
  /** Stable id from the desktop's local row so pushes are idempotent. */
  sourceId: z.string().min(1),
  kind: approvalKindSchema,
  /** Short headline shown in the inbox list, e.g. the post hook. */
  title: z.string().min(1),
  /** Full proposed post body / experiment description. */
  body: z.string(),
  /** Why the autopilot/experiment proposed this. */
  rationale: z.string().default(""),
  /** Platform key the action targets, e.g. "x". */
  targetPlatform: z.string().default(""),
  /** Unix epoch millis the action is scheduled for, if any. */
  scheduledFor: z.number().nullable().default(null),
});

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

const createPostSchema = z.object({
  body: z.string().min(1),
  platforms: z.array(z.string().min(1)).min(1),
  /** Optional Unix epoch millis to schedule for; null/absent posts now. */
  scheduledFor: z.number().nullable().default(null),
});

const registerTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]).default("ios"),
});

export const companionRouter = new Hono();

/**
 * GET /api/companion/approvals
 * List the signed-in user's pending approval actions, newest first.
 */
companionRouter.get("/approvals", async (c) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const items = await client
    .collection("companion_approvals")
    .find({ userId: user.id, status: "pending" })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  return c.json({
    items: items.map((item) => ({
      id: String(item._id),
      sourceId: item.sourceId,
      kind: item.kind,
      title: item.title,
      body: item.body,
      rationale: item.rationale,
      targetPlatform: item.targetPlatform,
      scheduledFor: item.scheduledFor ?? null,
      status: item.status,
      createdAt: item.createdAt,
    })),
  });
});

/**
 * POST /api/companion/approvals
 * Push a pending action (the desktop is the intended caller — see file header).
 * Upserts on (userId, sourceId) so re-pushes are idempotent.
 */
companionRouter.post("/approvals", async (c) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = createApprovalSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.issues }, 400);
  }

  const now = Date.now();
  const data = parsed.data;

  await client.collection("companion_approvals").updateOne(
    { userId: user.id, sourceId: data.sourceId },
    {
      $set: {
        kind: data.kind,
        title: data.title,
        body: data.body,
        rationale: data.rationale,
        targetPlatform: data.targetPlatform,
        scheduledFor: data.scheduledFor,
        updatedAt: now,
      },
      $setOnInsert: {
        userId: user.id,
        sourceId: data.sourceId,
        status: "pending",
        createdAt: now,
      },
    },
    { upsert: true }
  );

  // FOLLOW-UP: send an Expo push to this user's registered tokens here.
  return c.json({ success: true });
});

/**
 * POST /api/companion/approvals/:id/decision
 * Record a phone approve/reject decision on a pending action.
 *
 * FOLLOW-UP: the desktop must poll/subscribe for these decisions and reconcile
 * them into its local SQLite (mark the autopilot_action approved -> queue it via
 * its provider pipeline, or rejected). The server records the decision; the
 * local-first write-back is the documented follow-up.
 */
companionRouter.post("/approvals/:id/decision", async (c) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  if (!ObjectId.isValid(id)) {
    return c.json({ error: "Invalid id" }, 400);
  }
  const objectId = new ObjectId(id);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.issues }, 400);
  }

  const result = await client.collection("companion_approvals").updateOne(
    { _id: objectId, userId: user.id, status: "pending" },
    {
      $set: {
        status: parsed.data.decision,
        decidedAt: Date.now(),
        decidedFrom: "mobile",
      },
    }
  );

  if (result.matchedCount === 0) {
    return c.json({ error: "Not found or already decided" }, 404);
  }

  return c.json({ success: true, decision: parsed.data.decision });
});

/**
 * POST /api/companion/posts
 * Compose a post from the phone. Queued for the desktop to publish through its
 * real provider pipeline (the desktop holds the OAuth/Composio credentials, so
 * actual publishing happens there — see file header).
 */
companionRouter.post("/posts", async (c) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = createPostSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.issues }, 400);
  }

  const now = Date.now();
  const result = await client.collection("companion_posts").insertOne({
    userId: user.id,
    body: parsed.data.body,
    platforms: parsed.data.platforms,
    scheduledFor: parsed.data.scheduledFor,
    status: "queued",
    createdAt: now,
    source: "mobile",
  });

  return c.json({ success: true, id: String(result.insertedId) }, 201);
});

/**
 * GET /api/companion/posts
 * List the signed-in user's phone-composed posts, newest first.
 */
companionRouter.get("/posts", async (c) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const items = await client
    .collection("companion_posts")
    .find({ userId: user.id })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  return c.json({
    items: items.map((item) => ({
      id: String(item._id),
      body: item.body,
      platforms: item.platforms,
      scheduledFor: item.scheduledFor ?? null,
      status: item.status,
      createdAt: item.createdAt,
    })),
  });
});

/**
 * POST /api/companion/push-token
 * Register an Expo push token for the signed-in user's device. Upserts on the
 * token so re-registration is idempotent.
 *
 * FOLLOW-UP: sending pushes to these tokens (via Expo's push service) when an
 * approval lands is the server-side follow-up; this stores the token.
 */
companionRouter.post("/push-token", async (c) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = registerTokenSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", details: parsed.error.issues }, 400);
  }

  const now = Date.now();
  await client.collection("companion_push_tokens").updateOne(
    { token: parsed.data.token },
    {
      $set: {
        userId: user.id,
        platform: parsed.data.platform,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return c.json({ success: true });
});
