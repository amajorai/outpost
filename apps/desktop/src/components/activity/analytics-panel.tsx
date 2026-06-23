/**
 * The Activity section's Analytics subview (U23).
 *
 * Cross-platform dashboards beyond the feed: headline KPI cards, per-platform
 * engagement, an engagement-over-time chart, and the best-performing posts —
 * all computed from the same `activity_items` snapshot the feed renders (read
 * from `useActivityStore`). Plus a one-click weekly digest export to a file.
 *
 * The store's `refresh()` is owned by the Activity shell, not here, so switching
 * to this tab renders against already-loaded data instead of refetching. This
 * component is presentational: it derives everything with the pure helpers in
 * `lib/analytics/*` and never touches the DB or a provider directly.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { Download, Loader2, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { platformLabel } from "@/components/compose/platform-meta";
import {
  engagementByDay,
  engagementScore,
  overallKpis,
  platformKpis,
  topPosts,
} from "@/lib/analytics/analytics";
import { type DigestFormat, exportWeeklyDigest } from "@/lib/analytics/digest";
import { logger } from "@/lib/logger";
import type { ActivityItem } from "@/lib/social-schema";
import { useActivityStore } from "@/stores/use-activity-store";

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

const CHART_CONFIG = {
  engagement: {
    label: "Engagement",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

/** A short month/day label (e.g. "Jun 23") for an ISO date on the time axis. */
const AXIS_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatAxisDate(isoDate: string): string {
  // Parse as local midnight so the label matches the local bucketing.
  const [year, month, day] = isoDate.split("-").map(Number);
  return AXIS_DATE_FORMAT.format(new Date(year, month - 1, day));
}

interface KpiCardProps {
  label: string;
  value: number;
}

function KpiCard({ label, value }: KpiCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-semibold text-2xl tabular-nums">
          {formatCount(value)}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function GrowthChart({ items }: { items: ActivityItem[] }) {
  const data = useMemo(() => engagementByDay(items), [items]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
        No dated posts yet to chart.
      </div>
    );
  }

  return (
    <ChartContainer className="h-64 w-full" config={CHART_CONFIG}>
      <LineChart accessibilityLayer data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="date"
          tickFormatter={formatAxisDate}
          tickLine={false}
          tickMargin={8}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          width={32}
        />
        <ChartTooltip
          content={<ChartTooltipContent />}
          labelFormatter={(value) => formatAxisDate(String(value))}
        />
        <Line
          dataKey="engagement"
          dot={false}
          stroke="var(--color-engagement)"
          strokeWidth={2}
          type="monotone"
        />
      </LineChart>
    </ChartContainer>
  );
}

const TOP_POST_SNIPPET_LENGTH = 140;

function postSnippet(text: string | null): string {
  if (!text) {
    return "(no text)";
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TOP_POST_SNIPPET_LENGTH) {
    return oneLine;
  }
  return `${oneLine.slice(0, TOP_POST_SNIPPET_LENGTH - 1)}…`;
}

function TopPostRow({ item, rank }: { item: ActivityItem; rank: number }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <span className="mt-0.5 font-mono font-semibold text-muted-foreground text-sm tabular-nums">
        #{rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{platformLabel(item.platform)}</Badge>
          <span className="font-medium text-sm tabular-nums">
            {formatCount(engagementScore(item))} engagement
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
          {postSnippet(item.text)}
        </p>
      </div>
    </li>
  );
}

export function AnalyticsPanel() {
  const items = useActivityStore((s) => s.items);
  const [isExporting, setIsExporting] = useState(false);

  const overall = useMemo(() => overallKpis(items), [items]);
  const platforms = useMemo(() => platformKpis(items), [items]);
  const best = useMemo(() => topPosts(items), [items]);

  const handleExport = async (format: DigestFormat) => {
    setIsExporting(true);
    try {
      const result = await exportWeeklyDigest(items, format);
      if (result.written) {
        toast.success("Weekly digest exported", {
          description: result.path,
        });
      }
    } catch (error) {
      logger.error({ err: error }, "[Analytics] Digest export failed");
      toast.error("Couldn't export the digest. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const hasData = items.length > 0;

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Performance across every connected account, from your tracked posts.
        </p>
        <div className="flex items-center gap-2">
          <Button
            disabled={!hasData || isExporting}
            onClick={() => handleExport("markdown")}
            size="sm"
            variant="outline"
          >
            {isExporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export digest
          </Button>
          <Button
            disabled={!hasData || isExporting}
            onClick={() => handleExport("json")}
            size="sm"
            variant="ghost"
          >
            JSON
          </Button>
        </div>
      </div>

      {hasData ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Posts" value={overall.posts} />
            <KpiCard label="Engagement" value={overall.engagement} />
            <KpiCard label="Likes" value={overall.likes} />
            <KpiCard label="Comments" value={overall.comments} />
            <KpiCard label="Views" value={overall.views} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4" strokeWidth={1.5} />
                Engagement over time
              </CardTitle>
              <CardDescription>
                Total engagement of posts, grouped by the day they were
                published.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GrowthChart items={items} />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By platform</CardTitle>
                <CardDescription>
                  Tracked posts and engagement per platform.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {platforms.map((platform) => (
                    <li
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
                      key={platform.platform}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {platformLabel(platform.platform)}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {formatCount(platform.posts)} posts
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-sm tabular-nums">
                          {formatCount(platform.engagement)}
                        </span>
                        <span className="ml-1 text-muted-foreground text-xs">
                          ({formatCount(platform.avgEngagementPerPost)}/post)
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Best-performing posts
                </CardTitle>
                <CardDescription>
                  Ranked by likes, comments, and shares combined.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-2">
                  {best.map((item, index) => (
                    <TopPostRow item={item} key={item.id} rank={index + 1} />
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <TrendingUp className="size-6" strokeWidth={1.5} />
          </div>
          <p className="max-w-sm text-balance text-muted-foreground text-sm">
            No analytics yet. Publish from Outpost and your cross-platform
            performance will show up here.
          </p>
        </div>
      )}
    </div>
  );
}
