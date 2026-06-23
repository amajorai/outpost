/**
 * The Inbox section's main panel (U20).
 *
 * A unified engagement inbox: comments, replies, mentions, and DMs aggregated
 * across every connected account, gated by the capability matrix (DMs only
 * surface for platforms that support them, e.g. X / Instagram). Each item has
 * an inline reply box that calls the provider's `replyToInboxItem`; on success
 * the item is marked replied and persisted.
 *
 * Loading mirrors `CalendarPanel`: refresh on mount, render from the store. When
 * no provider can read any inbox, the empty state explains the degrade.
 */

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Textarea } from "@repo/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { Inbox, Loader2, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { platformLabel } from "@/components/compose/platform-meta";
import { getSectionMeta } from "@/components/nav/sections";
import type { InboxItem, InboxItemKind } from "@/lib/social-schema";
import { useInboxStore } from "@/stores/use-inbox-store";

const KIND_LABELS: Record<InboxItemKind, string> = {
  comment: "Comment",
  reply: "Reply",
  mention: "Mention",
  dm: "DM",
};

interface InboxRowProps {
  item: InboxItem;
  isReplying: boolean;
  onReply: (item: InboxItem, text: string) => Promise<boolean>;
}

function InboxRow({ item, isReplying, onReply }: InboxRowProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  const handleSend = useCallback(async () => {
    const sent = await onReply(item, draft);
    if (sent) {
      setDraft("");
      setOpen(false);
      toast("Reply sent");
    } else {
      toast("Could not send the reply");
    }
  }, [draft, item, onReply]);

  const received = useMemo(
    () => formatDistanceToNow(new Date(item.receivedAt), { addSuffix: true }),
    [item.receivedAt]
  );

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{item.author}</span>
        <Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
        <Badge variant="outline">{platformLabel(item.platform)}</Badge>
        {item.replied === 1 ? <Badge>Replied</Badge> : null}
        <span className="ml-auto text-muted-foreground text-xs">
          {received}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{item.text}</p>
      <div className="mt-3 flex items-center gap-2">
        {item.permalink ? (
          <a
            className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
            href={item.permalink}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open original
          </a>
        ) : null}
        <Button
          className="ml-auto"
          onClick={() => setOpen((value) => !value)}
          size="sm"
          variant="ghost"
        >
          {open ? "Cancel" : "Reply"}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            aria-label={`Reply to ${item.author}`}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a reply…"
            rows={3}
            value={draft}
          />
          <Button
            className="self-end"
            disabled={isReplying || draft.trim().length === 0}
            onClick={handleSend}
            size="sm"
          >
            {isReplying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send reply
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function InboxPanel() {
  const { label, description } = getSectionMeta("inbox");
  const items = useInboxStore((s) => s.items);
  const isLoading = useInboxStore((s) => s.isLoading);
  const replyingId = useInboxStore((s) => s.replyingId);
  const refresh = useInboxStore((s) => s.refresh);
  const reply = useInboxStore((s) => s.reply);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isEmpty = items.length === 0;

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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Inbox className="size-6" strokeWidth={1.5} />
            </div>
            <p className="max-w-sm text-balance text-muted-foreground text-sm">
              {isLoading
                ? "Loading your inbox…"
                : "No comments, replies, mentions, or DMs yet. Connect accounts whose platforms support engagement reads to see them here."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <InboxRow
                isReplying={replyingId === item.id}
                item={item}
                key={item.id}
                onReply={reply}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
