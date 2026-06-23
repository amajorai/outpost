/**
 * Bluesky direct-connection settings UI (U6).
 *
 * Bluesky connects directly via the AT Protocol with a BYO app password rather
 * than through Composio, so it needs a dedicated card: the generic Accounts
 * connect dialog only captures a label, but Bluesky needs a handle plus an app
 * password. Credentials are stored encrypted in secure storage and verified by
 * minting a session; on success we persist a `social_accounts` row (identity +
 * connected flag only, never the password) so the account is usable by the
 * publish pipeline and shows up alongside other accounts.
 */

import { Button } from "@repo/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import { Input } from "@repo/ui/input";
import { AtSign, Check, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { logger } from "@/lib/logger";
import {
  getBlueskyCredentials,
  getBlueskyProvider,
  hasBlueskyCredentials,
  removeBlueskyCredentials,
  resetBlueskyProvider,
  storeBlueskyCredentials,
} from "@/lib/providers";
import {
  createSocialAccount,
  listSocialAccounts,
  removeSocialAccount,
} from "@/lib/repos/social-accounts";

/** Leading `@` on a handle, stripped before building a label. */
const LEADING_AT_RE = /^@/;

/** Find the persisted Bluesky account row, if any, for the default workspace. */
async function findBlueskyAccountId(): Promise<string | null> {
  const accounts = await listSocialAccounts();
  const existing = accounts.find((a) => a.platform === "bluesky");
  return existing?.id ?? null;
}

export function BlueskySettings() {
  const [configured, setConfigured] = useState(false);
  const [handle, setHandle] = useState("");
  const [storedHandle, setStoredHandle] = useState<string | null>(null);
  const [appPassword, setAppPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const has = await hasBlueskyCredentials();
      setConfigured(has);
      const creds = has ? await getBlueskyCredentials() : null;
      setStoredHandle(creds?.handle ?? null);
    } catch (err) {
      logger.error({ err }, "[Bluesky] Failed to load settings");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      await storeBlueskyCredentials(handle, appPassword);
      resetBlueskyProvider();
      const provider = await getBlueskyProvider();
      if (!provider) {
        throw new Error("Bluesky credentials were not stored");
      }
      const cleanHandle = handle.trim().replace(LEADING_AT_RE, "");
      // Verify the credentials by establishing a session.
      await provider.connect({ id: "bluesky-verify", platform: "bluesky" });
      // Persist (or refresh) the account row so it is usable by the pipeline.
      const existingId = await findBlueskyAccountId();
      if (existingId) {
        await removeSocialAccount(existingId);
      }
      await createSocialAccount({
        id: crypto.randomUUID(),
        platform: "bluesky",
        accountLabel: `@${cleanHandle}`,
        connected: true,
      });
      setHandle("");
      setAppPassword("");
      setRevealed(false);
      await refresh();
    } catch (err) {
      // Roll back stored credentials when verification fails.
      await removeBlueskyCredentials().catch(() => {
        /* best effort */
      });
      resetBlueskyProvider();
      setError(
        err instanceof Error ? err.message : "Failed to connect Bluesky"
      );
    } finally {
      setIsLoading(false);
    }
  }, [handle, appPassword, refresh]);

  const handleRemove = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      await removeBlueskyCredentials();
      resetBlueskyProvider();
      const existingId = await findBlueskyAccountId();
      if (existingId) {
        await removeSocialAccount(existingId);
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to disconnect Bluesky"
      );
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AtSign className="size-4" strokeWidth={1.5} />
          Bluesky
        </CardTitle>
        <CardDescription>
          Connect Bluesky directly with an app password (Settings → App
          passwords in Bluesky). Outpost publishes via the AT Protocol; your app
          password is stored encrypted on this device and never leaves it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {configured ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs dark:text-emerald-400">
              <Check className="size-3" /> Connected
            </span>
            {storedHandle && (
              <span className="font-medium text-sm">@{storedHandle}</span>
            )}
            <Button
              className="ml-auto"
              disabled={isLoading}
              onClick={handleRemove}
              type="button"
              variant="destructive"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm" htmlFor="bluesky-handle">
                Handle
              </label>
              <Input
                autoComplete="off"
                id="bluesky-handle"
                onChange={(e) => setHandle(e.target.value)}
                placeholder="alice.bsky.social"
                value={handle}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                className="font-medium text-sm"
                htmlFor="bluesky-app-password"
              >
                App password
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    autoComplete="off"
                    id="bluesky-app-password"
                    onChange={(e) => setAppPassword(e.target.value)}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    type={revealed ? "text" : "password"}
                    value={appPassword}
                  />
                  <button
                    aria-label={
                      revealed ? "Hide app password" : "Reveal app password"
                    }
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setRevealed((v) => !v)}
                    type="button"
                  >
                    {revealed ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <Button
                  disabled={
                    isLoading ||
                    handle.trim().length === 0 ||
                    appPassword.trim().length === 0
                  }
                  onClick={handleConnect}
                  type="button"
                >
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
