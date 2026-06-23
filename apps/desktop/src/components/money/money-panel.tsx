/**
 * The Money section's main panel (U31): a creator-monetization hub.
 *
 * Three surfaces:
 *  - Deal tracker: a kanban grouped by deal status (lead -> negotiating ->
 *    active -> delivered -> paid) showing each deal's brand, rate, and
 *    deliverables, with controls to advance status, add, and remove deals.
 *  - Media-kit generator: a small profile form (name, tagline, audience,
 *    optional manual follower count, contact) that exports a media kit populated
 *    from the activity feed's real per-platform KPIs + top posts, as Markdown or
 *    HTML.
 *  - Tracked links: create UTM/affiliate links (destination + UTM params),
 *    copy the tagged URL, and record best-effort clicks.
 *
 * Loading mirrors `RadarPanel`: refresh on mount, render from the store. The
 * store owns the lifecycle; this view is presentation plus the editor forms.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Banknote,
  Check,
  Copy,
  FileDown,
  Link2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSectionMeta } from "@/components/nav/sections";
import {
  exportMediaKit,
  type MediaKitFormat,
  type MediaKitProfile,
} from "@/lib/money/media-kit";
import { buildTrackedUrl } from "@/lib/repos/tracked-links";
import type { Deal, DealStatus, TrackedLink } from "@/lib/social-schema";
import { useMoneyStore } from "@/stores/use-money-store";

const DEAL_STATUSES: readonly { value: DealStatus; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "negotiating", label: "Negotiating" },
  { value: "active", label: "Active" },
  { value: "delivered", label: "Delivered" },
  { value: "paid", label: "Paid" },
];

const CURRENCY_FORMAT_CACHE = new Map<string, Intl.NumberFormat>();

function formatRate(rate: number, currency: string): string {
  if (rate === 0) {
    return "—";
  }
  let formatter = CURRENCY_FORMAT_CACHE.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      formatter = new Intl.NumberFormat();
    }
    CURRENCY_FORMAT_CACHE.set(currency, formatter);
  }
  return formatter.format(rate);
}

function nextStatus(status: DealStatus): DealStatus | null {
  const index = DEAL_STATUSES.findIndex((s) => s.value === status);
  if (index < 0 || index >= DEAL_STATUSES.length - 1) {
    return null;
  }
  return DEAL_STATUSES[index + 1].value;
}

function AddDealForm() {
  const addDeal = useMoneyStore((s) => s.addDeal);
  const [brand, setBrand] = useState("");
  const [rate, setRate] = useState("");
  const [deliverables, setDeliverables] = useState("");

  const submit = async () => {
    const trimmedBrand = brand.trim();
    if (trimmedBrand.length === 0) {
      return;
    }
    const parsedRate = Number.parseFloat(rate);
    const lines = deliverables
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((description) => ({ description, done: false }));
    await addDeal({
      brand: trimmedBrand,
      rate: Number.isFinite(parsedRate) ? parsedRate : 0,
      deliverables: lines,
    });
    setBrand("");
    setRate("");
    setDeliverables("");
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="deal-brand">
            Brand
          </label>
          <Input
            id="deal-brand"
            onChange={(event) => setBrand(event.target.value)}
            placeholder="Acme Co."
            value={brand}
          />
        </div>
        <div className="flex w-32 flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="deal-rate">
            Rate (USD)
          </label>
          <Input
            id="deal-rate"
            inputMode="decimal"
            onChange={(event) => setRate(event.target.value)}
            placeholder="2500"
            value={rate}
          />
        </div>
        <Button size="sm" type="submit">
          <Plus className="size-4" />
          Add deal
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-medium text-xs" htmlFor="deal-deliverables">
          Deliverables (one per line)
        </label>
        <textarea
          className="min-h-16 rounded-md border border-input bg-transparent p-2 text-sm"
          id="deal-deliverables"
          onChange={(event) => setDeliverables(event.target.value)}
          placeholder={"1 dedicated post\n3-tweet thread"}
          value={deliverables}
        />
      </div>
    </form>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const moveDeal = useMoneyStore((s) => s.moveDeal);
  const removeDeal = useMoneyStore((s) => s.removeDeal);
  const advance = nextStatus(deal.status);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm">{deal.brand}</span>
        <span className="font-semibold text-sm tabular-nums">
          {formatRate(deal.rate, deal.currency)}
        </span>
      </div>
      {deal.deliverables.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {deal.deliverables.map((deliverable, index) => (
            <li
              className="flex items-center gap-1.5 text-muted-foreground text-xs"
              // biome-ignore lint/suspicious/noArrayIndexKey: deliverables are an ordered positional list with no stable id
              key={index}
            >
              {deliverable.done ? (
                <Check className="size-3 text-primary" />
              ) : (
                <span className="size-3" />
              )}
              {deliverable.description}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-1">
        {advance ? (
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => moveDeal(deal.id, advance)}
            size="sm"
            type="button"
            variant="outline"
          >
            Move to {DEAL_STATUSES.find((s) => s.value === advance)?.label}
          </Button>
        ) : null}
        <Button
          aria-label={`Delete ${deal.brand} deal`}
          className="ml-auto size-7"
          onClick={() => removeDeal(deal.id)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function DealKanban({ deals }: { deals: Deal[] }) {
  const byStatus = useMemo(() => {
    const map = new Map<DealStatus, Deal[]>();
    for (const status of DEAL_STATUSES) {
      map.set(status.value, []);
    }
    for (const deal of deals) {
      map.get(deal.status)?.push(deal);
    }
    return map;
  }, [deals]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {DEAL_STATUSES.map((status) => {
        const column = byStatus.get(status.value) ?? [];
        return (
          <div className="flex flex-col gap-2" key={status.value}>
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">{status.label}</h3>
              <Badge variant="outline">{column.length}</Badge>
            </div>
            <ul className="flex flex-col gap-2">
              {column.map((deal) => (
                <DealCard deal={deal} key={deal.id} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function MediaKitGenerator() {
  const activityItems = useMoneyStore((s) => s.activityItems);
  const [profile, setProfile] = useState<MediaKitProfile>({});
  const [followers, setFollowers] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  const setField = (key: keyof MediaKitProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value || undefined }));
  };

  const runExport = async (format: MediaKitFormat) => {
    setIsExporting(true);
    setExportError(null);
    setExportedPath(null);
    try {
      const parsedFollowers = Number.parseInt(followers, 10);
      const fullProfile: MediaKitProfile = {
        ...profile,
        followers: Number.isFinite(parsedFollowers)
          ? parsedFollowers
          : undefined,
      };
      const result = await exportMediaKit(activityItems, fullProfile, format);
      if (result.written && result.path) {
        setExportedPath(result.path);
      }
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Failed to export media kit"
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-sm">Media kit</h2>
        <p className="text-muted-foreground text-xs">
          Auto-populated from your tracked activity (per-platform engagement and
          top posts). Follower count is optional and entered by you — the app
          does not track follower numbers.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="mk-name">
            Name
          </label>
          <Input
            id="mk-name"
            onChange={(event) => setField("name", event.target.value)}
            placeholder="Your name / brand"
            value={profile.name ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="mk-tagline">
            Tagline
          </label>
          <Input
            id="mk-tagline"
            onChange={(event) => setField("tagline", event.target.value)}
            placeholder="What you make"
            value={profile.tagline ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="mk-audience">
            Audience
          </label>
          <Input
            id="mk-audience"
            onChange={(event) => setField("audience", event.target.value)}
            placeholder="Who follows you"
            value={profile.audience ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="mk-followers">
            Followers (optional, manual)
          </label>
          <Input
            id="mk-followers"
            inputMode="numeric"
            onChange={(event) => setFollowers(event.target.value)}
            placeholder="e.g. 12000"
            value={followers}
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="font-medium text-xs" htmlFor="mk-contact">
            Contact
          </label>
          <Input
            id="mk-contact"
            onChange={(event) => setField("contact", event.target.value)}
            placeholder="sponsors@example.com"
            value={profile.contact ?? ""}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={isExporting}
          onClick={() => runExport("markdown")}
          size="sm"
          type="button"
        >
          {isExporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileDown className="size-4" />
          )}
          Export Markdown
        </Button>
        <Button
          disabled={isExporting}
          onClick={() => runExport("html")}
          size="sm"
          type="button"
          variant="outline"
        >
          <FileDown className="size-4" />
          Export HTML
        </Button>
      </div>
      {exportError ? (
        <p className="text-destructive text-xs">{exportError}</p>
      ) : null}
      {exportedPath ? (
        <p className="text-muted-foreground text-xs">Saved to {exportedPath}</p>
      ) : null}
    </div>
  );
}

function AddLinkForm() {
  const addLink = useMoneyStore((s) => s.addLink);
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");

  const submit = async () => {
    const trimmedLabel = label.trim();
    const trimmedDestination = destination.trim();
    if (trimmedLabel.length === 0 || trimmedDestination.length === 0) {
      return;
    }
    await addLink({
      label: trimmedLabel,
      destinationUrl: trimmedDestination,
      utm: {
        source: source.trim() || null,
        medium: medium.trim() || null,
        campaign: campaign.trim() || null,
      },
    });
    setLabel("");
    setDestination("");
    setSource("");
    setMedium("");
    setCampaign("");
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="link-label">
            Label
          </label>
          <Input
            id="link-label"
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Spring sale - X bio"
            value={label}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="link-destination">
            Destination URL
          </label>
          <Input
            id="link-destination"
            onChange={(event) => setDestination(event.target.value)}
            placeholder="https://example.com/offer"
            value={destination}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="link-source">
            utm_source
          </label>
          <Input
            id="link-source"
            onChange={(event) => setSource(event.target.value)}
            placeholder="twitter"
            value={source}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="link-medium">
            utm_medium
          </label>
          <Input
            id="link-medium"
            onChange={(event) => setMedium(event.target.value)}
            placeholder="social"
            value={medium}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-medium text-xs" htmlFor="link-campaign">
            utm_campaign
          </label>
          <Input
            id="link-campaign"
            onChange={(event) => setCampaign(event.target.value)}
            placeholder="spring-sale"
            value={campaign}
          />
        </div>
      </div>
      <Button className="self-start" size="sm" type="submit">
        <Plus className="size-4" />
        Create link
      </Button>
    </form>
  );
}

function LinkRow({ link }: { link: TrackedLink }) {
  const bumpLinkClicks = useMoneyStore((s) => s.bumpLinkClicks);
  const removeLink = useMoneyStore((s) => s.removeLink);
  const [copied, setCopied] = useState(false);
  const taggedUrl = useMemo(() => buildTrackedUrl(link), [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(taggedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; the URL is still shown for manual copy.
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{link.label}</span>
        <Badge variant="outline">/{link.shortCode}</Badge>
      </div>
      <p className="break-all text-muted-foreground text-xs">{taggedUrl}</p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          className="h-7 px-2 text-xs"
          onClick={copy}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          className="h-7 px-2 text-xs"
          onClick={() => bumpLinkClicks(link.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {link.clicks} clicks +1
        </Button>
        <Button
          aria-label={`Delete ${link.label} link`}
          className="ml-auto size-7"
          onClick={() => removeLink(link.id)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

export function MoneyPanel() {
  const { label, description } = getSectionMeta("money");
  const deals = useMoneyStore((s) => s.deals);
  const links = useMoneyStore((s) => s.links);
  const isLoading = useMoneyStore((s) => s.isLoading);
  const error = useMoneyStore((s) => s.error);
  const refresh = useMoneyStore((s) => s.refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Banknote className="size-4 text-muted-foreground" />
            <h2 className="font-medium text-sm">Deal tracker</h2>
          </div>
          <AddDealForm />
          {deals.length > 0 ? (
            <DealKanban deals={deals} />
          ) : (
            <p className="text-muted-foreground text-sm">
              No deals yet. Add a brand deal to start tracking your pipeline.
            </p>
          )}
        </div>

        <MediaKitGenerator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-muted-foreground" />
            <h2 className="font-medium text-sm">Tracked links</h2>
          </div>
          <AddLinkForm />
          {links.length > 0 ? (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {links.map((link) => (
                <LinkRow key={link.id} link={link} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No links yet. Create a UTM/affiliate link to share and track.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
