/**
 * Media-kit generator (U31).
 *
 * Builds a sponsorship media kit from the data the app already has: the
 * `ActivityItem[]` snapshot the Activity feed and analytics use (per-platform
 * KPIs + best-performing posts), plus a small set of user-supplied profile
 * details. Compute (`buildMediaKit`) and rendering (`formatMediaKitMarkdown` /
 * `formatMediaKitHtml`) are pure; only `exportMediaKit` touches Tauri (dialog +
 * fs), mirroring the digest module's pure-relative-to-IO split.
 *
 * Honesty note: the schema has NO follower count anywhere (analytics.ts documents
 * this). We never fabricate one. `followers` here is an OPTIONAL, explicitly
 * user-supplied number entered in the media-kit form — omitted entirely from the
 * output when not provided. Reach is reported as the `views` the activity feed
 * actually carries.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { platformLabel } from "@/components/compose/platform-meta";
import {
  overallKpis,
  type PlatformKpis,
  platformKpis,
  topPosts,
} from "@/lib/analytics/analytics";
import type { ActivityItem } from "@/lib/social-schema";

/** User-supplied profile details for the media kit. All optional. */
export interface MediaKitProfile {
  /** Creator / brand name shown as the kit's title. */
  name?: string;
  /** Short positioning blurb. */
  tagline?: string;
  /** Contact email or handle for sponsorship inquiries. */
  contact?: string;
  /**
   * Total follower/subscriber count. EXPLICITLY user-supplied — there is no
   * follower data in the schema, so this is omitted from the output when unset.
   */
  followers?: number;
  /** Niche / audience description. */
  audience?: string;
}

const TOP_POSTS_IN_KIT = 5;

/** One top post as rendered in the media kit. */
export interface MediaKitTopPost {
  platform: string;
  text: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  permalink: string | null;
}

/** The computed media-kit data, before rendering to a format. */
export interface MediaKit {
  profile: MediaKitProfile;
  generatedAt: string;
  totals: {
    posts: number;
    engagement: number;
    likes: number;
    comments: number;
    shares: number;
    views: number;
  };
  platforms: PlatformKpis[];
  topPosts: MediaKitTopPost[];
}

const TOP_POST_SNIPPET_LENGTH = 100;
const NUMBER_FORMAT = new Intl.NumberFormat();

function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function snippet(text: string | null): string {
  const oneLine = (text ?? "").replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) {
    return "(no text)";
  }
  if (oneLine.length <= TOP_POST_SNIPPET_LENGTH) {
    return oneLine;
  }
  return `${oneLine.slice(0, TOP_POST_SNIPPET_LENGTH - 1)}…`;
}

/**
 * Compute the media kit from the activity snapshot plus the user's profile.
 * Pure — the caller passes the `ActivityItem[]` it already loaded, the same way
 * the digest builder works.
 */
export function buildMediaKit(
  items: ActivityItem[],
  profile: MediaKitProfile = {},
  now: Date = new Date()
): MediaKit {
  const totals = overallKpis(items);
  return {
    profile,
    generatedAt: now.toISOString(),
    totals: {
      posts: totals.posts,
      engagement: totals.engagement,
      likes: totals.likes,
      comments: totals.comments,
      shares: totals.shares,
      views: totals.views,
    },
    platforms: platformKpis(items),
    topPosts: topPosts(items, TOP_POSTS_IN_KIT).map((post) => ({
      platform: post.platform,
      text: snippet(post.text),
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      views: post.views,
      permalink: post.permalink,
    })),
  };
}

/** Render the media kit to Markdown. */
export function formatMediaKitMarkdown(kit: MediaKit): string {
  const { profile, totals } = kit;
  const lines: string[] = [];

  lines.push(`# ${profile.name ?? "Media Kit"}`);
  lines.push("");
  if (profile.tagline) {
    lines.push(`_${profile.tagline}_`);
    lines.push("");
  }
  if (profile.audience) {
    lines.push(`**Audience:** ${profile.audience}`);
    lines.push("");
  }
  if (profile.followers != null) {
    lines.push(`**Following:** ${formatNumber(profile.followers)}`);
    lines.push("");
  }
  lines.push(`Generated ${kit.generatedAt.slice(0, 10)}`);
  lines.push("");

  lines.push("## Audience engagement");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Tracked posts | ${formatNumber(totals.posts)} |`);
  lines.push(`| Total engagement | ${formatNumber(totals.engagement)} |`);
  lines.push(`| Likes | ${formatNumber(totals.likes)} |`);
  lines.push(`| Comments | ${formatNumber(totals.comments)} |`);
  lines.push(`| Shares | ${formatNumber(totals.shares)} |`);
  lines.push(`| Views (reach) | ${formatNumber(totals.views)} |`);
  lines.push("");

  lines.push("## By platform");
  lines.push("");
  if (kit.platforms.length === 0) {
    lines.push("_No tracked posts yet._");
  } else {
    lines.push("| Platform | Posts | Engagement | Avg / post |");
    lines.push("| --- | --- | --- | --- |");
    for (const platform of kit.platforms) {
      lines.push(
        `| ${platformLabel(platform.platform)} | ${formatNumber(platform.posts)} | ${formatNumber(platform.engagement)} | ${formatNumber(platform.avgEngagementPerPost)} |`
      );
    }
  }
  lines.push("");

  lines.push("## Top-performing content");
  lines.push("");
  if (kit.topPosts.length === 0) {
    lines.push("_No tracked posts yet._");
  } else {
    for (const [index, post] of kit.topPosts.entries()) {
      lines.push(
        `${index + 1}. [${platformLabel(post.platform)}] ${post.text}`
      );
      lines.push(
        `   ${formatNumber(post.likes)} likes · ${formatNumber(post.comments)} comments · ${formatNumber(post.shares)} shares · ${formatNumber(post.views)} views`
      );
      if (post.permalink) {
        lines.push(`   ${post.permalink}`);
      }
      lines.push("");
    }
  }

  if (profile.contact) {
    lines.push("## Contact");
    lines.push("");
    lines.push(profile.contact);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

const HTML_ESCAPE = /[&<>"']/g;
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE, (char) => HTML_ESCAPES[char] ?? char);
}

/** Render the media kit to a self-contained HTML document. */
export function formatMediaKitHtml(kit: MediaKit): string {
  const { profile, totals } = kit;
  const title = escapeHtml(profile.name ?? "Media Kit");
  const parts: string[] = [];

  parts.push(`<h1>${title}</h1>`);
  if (profile.tagline) {
    parts.push(`<p><em>${escapeHtml(profile.tagline)}</em></p>`);
  }
  if (profile.audience) {
    parts.push(
      `<p><strong>Audience:</strong> ${escapeHtml(profile.audience)}</p>`
    );
  }
  if (profile.followers != null) {
    parts.push(
      `<p><strong>Following:</strong> ${formatNumber(profile.followers)}</p>`
    );
  }
  parts.push(
    `<p class="muted">Generated ${escapeHtml(kit.generatedAt.slice(0, 10))}</p>`
  );

  parts.push("<h2>Audience engagement</h2>");
  parts.push("<table>");
  parts.push("<tr><th>Metric</th><th>Value</th></tr>");
  const totalRows: [string, number][] = [
    ["Tracked posts", totals.posts],
    ["Total engagement", totals.engagement],
    ["Likes", totals.likes],
    ["Comments", totals.comments],
    ["Shares", totals.shares],
    ["Views (reach)", totals.views],
  ];
  for (const [label, value] of totalRows) {
    parts.push(`<tr><td>${label}</td><td>${formatNumber(value)}</td></tr>`);
  }
  parts.push("</table>");

  parts.push("<h2>By platform</h2>");
  if (kit.platforms.length === 0) {
    parts.push("<p><em>No tracked posts yet.</em></p>");
  } else {
    parts.push("<table>");
    parts.push(
      "<tr><th>Platform</th><th>Posts</th><th>Engagement</th><th>Avg / post</th></tr>"
    );
    for (const platform of kit.platforms) {
      parts.push(
        `<tr><td>${escapeHtml(platformLabel(platform.platform))}</td><td>${formatNumber(platform.posts)}</td><td>${formatNumber(platform.engagement)}</td><td>${formatNumber(platform.avgEngagementPerPost)}</td></tr>`
      );
    }
    parts.push("</table>");
  }

  parts.push("<h2>Top-performing content</h2>");
  if (kit.topPosts.length === 0) {
    parts.push("<p><em>No tracked posts yet.</em></p>");
  } else {
    parts.push("<ol>");
    for (const post of kit.topPosts) {
      const link = post.permalink
        ? ` <a href="${escapeHtml(post.permalink)}">link</a>`
        : "";
      parts.push(
        `<li><strong>[${escapeHtml(platformLabel(post.platform))}]</strong> ${escapeHtml(post.text)}<br><span class="muted">${formatNumber(post.likes)} likes · ${formatNumber(post.comments)} comments · ${formatNumber(post.shares)} shares · ${formatNumber(post.views)} views</span>${link}</li>`
      );
    }
    parts.push("</ol>");
  }

  if (profile.contact) {
    parts.push("<h2>Contact</h2>");
    parts.push(`<p>${escapeHtml(profile.contact)}</p>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #111; line-height: 1.5; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #eee; padding-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; }
  th { font-weight: 600; }
  .muted { color: #666; font-size: 0.85rem; }
  ol { padding-left: 1.25rem; }
  li { margin-bottom: 0.75rem; }
  a { color: #2563eb; }
</style>
</head>
<body>
${parts.join("\n")}
</body>
</html>
`;
}

export type MediaKitFormat = "markdown" | "html";

function defaultMediaKitFilename(format: MediaKitFormat, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const ext = format === "html" ? "html" : "md";
  return `outpost-media-kit-${date}.${ext}`;
}

export interface ExportMediaKitResult {
  /** Whether a file was written. False when the user cancelled the dialog. */
  written: boolean;
  /** The path written to, when `written` is true. */
  path?: string;
}

/**
 * Build the media kit, prompt for a save location, and write it. Returns
 * `{ written: false }` when the user cancels the dialog. Throws if the write
 * itself fails, so the caller can surface the error.
 */
export async function exportMediaKit(
  items: ActivityItem[],
  profile: MediaKitProfile,
  format: MediaKitFormat = "markdown",
  now: Date = new Date()
): Promise<ExportMediaKitResult> {
  const kit = buildMediaKit(items, profile, now);
  const contents =
    format === "html" ? formatMediaKitHtml(kit) : formatMediaKitMarkdown(kit);
  const filters =
    format === "html"
      ? [{ name: "HTML", extensions: ["html"] }]
      : [{ name: "Markdown", extensions: ["md"] }];

  const path = await save({
    defaultPath: defaultMediaKitFilename(format, now),
    filters,
  });
  if (path == null) {
    return { written: false };
  }

  await writeTextFile(path, contents);
  return { written: true, path };
}
