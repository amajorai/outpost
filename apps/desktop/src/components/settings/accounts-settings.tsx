/**
 * Accounts settings UI (U5).
 *
 * Lists the platforms Outpost can connect, with Connect/Disconnect, connection
 * status, and the platform's capabilities (from the provider capability matrix).
 * Multiple accounts per platform are supported. Connecting opens a dialog to
 * capture a human-friendly label, since the provider `connect()` seam returns no
 * handle. Tokens are owned by the provider and never stored here.
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Loader2, Plug, Unplug, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CapabilityMatrix,
  Platform,
  PlatformCapabilities,
} from "@/lib/providers";
import type { SocialAccount } from "@/lib/social-schema";
import { useIntegrationStore } from "@/stores/use-integration-store";
import {
  SUPPORTED_PLATFORMS,
  useSocialAccountsStore,
} from "@/stores/use-social-accounts-store";

/** Display names for the platforms U5 supports. */
const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  facebook: "Facebook",
  bluesky: "Bluesky",
  threads: "Threads",
};

/** Capability flags rendered as badges, in a stable order. */
const CAPABILITY_BADGES: { key: keyof PlatformCapabilities; label: string }[] =
  [
    { key: "publish", label: "Publish" },
    { key: "readEngagement", label: "Engagement" },
    { key: "readComments", label: "Comments" },
    { key: "readDMs", label: "Read DMs" },
    { key: "sendDM", label: "Send DMs" },
  ];

function CapabilityBadges({
  capabilities,
}: {
  capabilities: PlatformCapabilities | undefined;
}) {
  if (!capabilities) {
    return null;
  }
  const enabled = CAPABILITY_BADGES.filter(({ key }) => capabilities[key]);
  if (enabled.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        No actions available
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {enabled.map(({ key, label }) => (
        <Badge key={key} variant="secondary">
          {label}
        </Badge>
      ))}
    </div>
  );
}

function AccountRow({
  account,
  isDisconnecting,
  onDisconnect,
}: {
  account: SocialAccount;
  isDisconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={
            account.connected
              ? "size-2 rounded-full bg-emerald-500"
              : "size-2 rounded-full bg-muted-foreground"
          }
        />
        <span className="font-medium text-sm">{account.accountLabel}</span>
        <span className="text-muted-foreground text-xs">
          {account.connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <Button
        disabled={isDisconnecting}
        onClick={onDisconnect}
        size="sm"
        type="button"
        variant="ghost"
      >
        {isDisconnecting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Unplug className="size-4" />
        )}
        Disconnect
      </Button>
    </div>
  );
}

function PlatformGroup({
  platform,
  accounts,
  capabilities,
  connectingPlatform,
  disconnectingId,
  onConnect,
  onDisconnect,
}: {
  platform: Platform;
  accounts: SocialAccount[];
  capabilities: PlatformCapabilities | undefined;
  connectingPlatform: Platform | null;
  disconnectingId: string | null;
  onConnect: (platform: Platform) => void;
  onDisconnect: (account: SocialAccount) => void;
}) {
  const isConnecting = connectingPlatform === platform;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-sm">
            {PLATFORM_LABELS[platform]}
          </span>
          <CapabilityBadges capabilities={capabilities} />
        </div>
        <Button
          disabled={isConnecting}
          onClick={() => onConnect(platform)}
          size="sm"
          type="button"
          variant="outline"
        >
          {isConnecting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plug className="size-4" />
          )}
          Connect
        </Button>
      </div>
      {accounts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {accounts.map((account) => (
            <AccountRow
              account={account}
              isDisconnecting={disconnectingId === account.id}
              key={account.id}
              onDisconnect={() => onDisconnect(account)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function accountsByPlatform(
  accounts: SocialAccount[]
): Record<string, SocialAccount[]> {
  const grouped: Record<string, SocialAccount[]> = {};
  for (const account of accounts) {
    const list = grouped[account.platform] ?? [];
    list.push(account);
    grouped[account.platform] = list;
  }
  return grouped;
}

export function AccountsSettings() {
  const accounts = useSocialAccountsStore((s) => s.accounts);
  const connectingPlatform = useSocialAccountsStore(
    (s) => s.connectingPlatform
  );
  const disconnectingId = useSocialAccountsStore((s) => s.disconnectingId);
  const refresh = useSocialAccountsStore((s) => s.refresh);
  const connect = useSocialAccountsStore((s) => s.connect);
  const disconnect = useSocialAccountsStore((s) => s.disconnect);

  const capabilityMatrix = useIntegrationStore((s) => s.capabilityMatrix);
  const refreshIntegration = useIntegrationStore((s) => s.refresh);

  const [dialogPlatform, setDialogPlatform] = useState<Platform | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    refreshIntegration();
  }, [refresh, refreshIntegration]);

  const grouped = useMemo(() => accountsByPlatform(accounts), [accounts]);

  const matrix: CapabilityMatrix | null = capabilityMatrix;

  const openConnectDialog = useCallback((platform: Platform) => {
    setError(null);
    setLabelDraft("");
    setDialogPlatform(platform);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogPlatform(null);
    setLabelDraft("");
    setError(null);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!dialogPlatform) {
      return;
    }
    setError(null);
    try {
      await connect(dialogPlatform, labelDraft);
      closeDialog();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect the account"
      );
    }
  }, [connect, dialogPlatform, labelDraft, closeDialog]);

  const handleDisconnect = useCallback(
    async (account: SocialAccount) => {
      setError(null);
      try {
        await disconnect(account);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to disconnect the account"
        );
      }
    },
    [disconnect]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" strokeWidth={1.5} />
          Connected accounts
        </CardTitle>
        <CardDescription>
          Connect the platforms you publish to. Tokens are managed by your
          provider and never stored by Outpost. You can connect more than one
          account per platform. Capabilities apply to every account on a
          platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {SUPPORTED_PLATFORMS.map((platform) => (
          <PlatformGroup
            accounts={grouped[platform] ?? []}
            capabilities={matrix?.[platform]}
            connectingPlatform={connectingPlatform}
            disconnectingId={disconnectingId}
            key={platform}
            onConnect={openConnectDialog}
            onDisconnect={handleDisconnect}
            platform={platform}
          />
        ))}

        {error && dialogPlatform === null && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </CardContent>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        open={dialogPlatform !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Connect {dialogPlatform ? PLATFORM_LABELS[dialogPlatform] : ""}
            </DialogTitle>
            <DialogDescription>
              Give this account a label so you can tell it apart from your other
              accounts.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label
              className="font-medium text-sm"
              htmlFor="account-label-input"
            >
              Account label
            </label>
            <Input
              autoComplete="off"
              id="account-label-input"
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="@yourhandle"
              value={labelDraft}
            />
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              }
            />
            <Button
              disabled={
                labelDraft.trim().length === 0 || connectingPlatform !== null
              }
              onClick={handleConnect}
              type="button"
            >
              {connectingPlatform !== null ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
