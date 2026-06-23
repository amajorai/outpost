/**
 * The Activity section's main panel (U21).
 *
 * A single feed of the user's published posts across every connected account,
 * each with its latest engagement counts (likes / comments / shares / views).
 * The feed is filterable by platform and by account, and a manual refresh
 * re-reads the latest metrics from each post's provider.
 *
 * Loading mirrors `InboxPanel`: refresh on mount, render from the store. Posts on
 * platforms whose provider can't read engagement still appear, just with zeroed
 * counts — the clean degrade the capability matrix gates.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Repeat2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import type { ActivityItem, SocialAccount } from "@/lib/social-schema";
import { useActivityStore } from "@/stores/use-activity-store";

/** Sentinel filter value meaning "no filter applied". */
const ALL = "all";

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

interface MetricProps {
  icon: typeof Heart;
  label: string;
  value: number;
}

function Metric({ icon: Icon, label, value }: MetricProps) {
  return (
    <span
      className="flex items-center gap-1 text-muted-foreground text-xs"
      title={label}
    >
      <Icon className="size-3.5" strokeWidth={1.5} />
      {formatCount(value)}
    </span>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const published = useMemo(
    () =>
      item.publishedAt
        ? formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })
        : null,
    [item.publishedAt]
  );

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{platformLabel(item.platform)}</Badge>
        {published ? (
          <span className="text-muted-foreground text-xs">{published}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <Metric icon={Heart} label="Likes" value={item.likes} />
          <Metric icon={MessageCircle} label="Comments" value={item.comments} />
          <Metric icon={Repeat2} label="Shares" value={item.shares} />
          <Metric icon={Eye} label="Views" value={item.views} />
        </div>
      </div>
      {item.text ? (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed">{item.text}</p>
      ) : null}
      {item.permalink ? (
        <div className="mt-3">
          <a
            className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
            href={item.permalink}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open post
          </a>
        </div>
      ) : null}
    </li>
  );
}

interface FilterPillsProps {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}

function FilterPills({ options, selected, onSelect }: FilterPillsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Button
          key={option.value}
          onClick={() => onSelect(option.value)}
          size="sm"
          variant={selected === option.value ? "default" : "outline"}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function platformOptions(items: ActivityItem[]) {
  const platforms = [...new Set(items.map((item) => item.platform))];
  return [
    { value: ALL, label: "All platforms" },
    ...platforms.map((platform) => ({
      value: platform,
      label: platformLabel(platform),
    })),
  ];
}

function accountOptions(items: ActivityItem[], accounts: SocialAccount[]) {
  const accountIds = [...new Set(items.map((item) => item.socialAccountId))];
  const labelFor = (id: string) =>
    accounts.find((account) => account.id === id)?.accountLabel ?? id;
  return [
    { value: ALL, label: "All accounts" },
    ...accountIds.map((id) => ({ value: id, label: labelFor(id) })),
  ];
}

export function ActivityPanel() {
  const { label, description } = getSectionMeta("activity");
  const items = useActivityStore((s) => s.items);
  const accounts = useActivityStore((s) => s.accounts);
  const isLoading = useActivityStore((s) => s.isLoading);
  const refresh = useActivityStore((s) => s.refresh);

  const [platformFilter, setPlatformFilter] = useState(ALL);
  const [accountFilter, setAccountFilter] = useState(ALL);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const platformOk =
          platformFilter === ALL || item.platform === platformFilter;
        const accountOk =
          accountFilter === ALL || item.socialAccountId === accountFilter;
        return platformOk && accountOk;
      }),
    [items, platformFilter, accountFilter]
  );

  const isEmpty = filtered.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex items-center justify-between gap-4 pb-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => refresh()}
          size="sm"
          variant="outline"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </header>

      <div className="flex flex-col gap-2 pb-4">
        <FilterPills
          onSelect={setPlatformFilter}
          options={platformOptions(items)}
          selected={platformFilter}
        />
        <FilterPills
          onSelect={setAccountFilter}
          options={accountOptions(items, accounts)}
          selected={accountFilter}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Activity className="size-6" strokeWidth={1.5} />
            </div>
            <p className="max-w-sm text-balance text-muted-foreground text-sm">
              {isLoading
                ? "Loading your activity…"
                : "No published posts yet. Once you publish from Outpost, your posts and their engagement will appear here."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {filtered.map((item) => (
              <ActivityRow item={item} key={item.id} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
