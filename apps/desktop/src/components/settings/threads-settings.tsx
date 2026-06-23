/**
 * Threads direct-connection settings UI (U7).
 *
 * Threads connects directly to the Meta Threads Graph API with a BYO long-lived
 * access token plus the Threads user id, rather than through Composio, so it
 * needs a dedicated card: the generic Accounts connect dialog only captures a
 * label, but Threads needs a token and a user id. Both are stored encrypted in
 * secure storage and verified by reading the user profile; on success we persist
 * a `social_accounts` row (identity + connected flag only, never the token) so
 * the account is usable by the publish pipeline and shows up alongside others.
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
  getThreadsCredentials,
  getThreadsProvider,
  hasThreadsCredentials,
  removeThreadsCredentials,
  resetThreadsProvider,
  storeThreadsCredentials,
} from "@/lib/providers";
import {
  createSocialAccount,
  listSocialAccounts,
  removeSocialAccount,
} from "@/lib/repos/social-accounts";

/** Find the persisted Threads account row, if any, for the default workspace. */
async function findThreadsAccountId(): Promise<string | null> {
  const accounts = await listSocialAccounts();
  const existing = accounts.find((a) => a.platform === "threads");
  return existing?.id ?? null;
}

export function ThreadsSettings() {
  const [configured, setConfigured] = useState(false);
  const [storedUserId, setStoredUserId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const has = await hasThreadsCredentials();
      setConfigured(has);
      const creds = has ? await getThreadsCredentials() : null;
      setStoredUserId(creds?.userId ?? null);
    } catch (err) {
      logger.error({ err }, "[Threads] Failed to load settings");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      await storeThreadsCredentials(accessToken, userId);
      resetThreadsProvider();
      const provider = await getThreadsProvider();
      if (!provider) {
        throw new Error("Threads credentials were not stored");
      }
      // Verify the token by reading the user profile.
      await provider.connect({ id: "threads-verify", platform: "threads" });
      // Persist (or refresh) the account row so it is usable by the pipeline.
      const existingId = await findThreadsAccountId();
      if (existingId) {
        await removeSocialAccount(existingId);
      }
      await createSocialAccount({
        id: crypto.randomUUID(),
        platform: "threads",
        accountLabel: `Threads (${userId.trim()})`,
        externalId: userId.trim(),
        connected: true,
      });
      setAccessToken("");
      setUserId("");
      setRevealed(false);
      await refresh();
    } catch (err) {
      // Roll back stored credentials when verification fails.
      await removeThreadsCredentials().catch(() => {
        /* best effort */
      });
      resetThreadsProvider();
      setError(
        err instanceof Error ? err.message : "Failed to connect Threads"
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, userId, refresh]);

  const handleRemove = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      await removeThreadsCredentials();
      resetThreadsProvider();
      const existingId = await findThreadsAccountId();
      if (existingId) {
        await removeSocialAccount(existingId);
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to disconnect Threads"
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
          Threads
        </CardTitle>
        <CardDescription>
          Connect Threads directly with a long-lived access token and your
          Threads user id (from your Meta app). Outpost publishes via the
          Threads Graph API; your token is stored encrypted on this device,
          refreshed automatically, and never leaves it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {configured ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs dark:text-emerald-400">
              <Check className="size-3" /> Connected
            </span>
            {storedUserId && (
              <span className="font-medium text-sm">{storedUserId}</span>
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
              <label className="font-medium text-sm" htmlFor="threads-user-id">
                User id
              </label>
              <Input
                autoComplete="off"
                id="threads-user-id"
                onChange={(e) => setUserId(e.target.value)}
                placeholder="1234567890"
                value={userId}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                className="font-medium text-sm"
                htmlFor="threads-access-token"
              >
                Access token
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    autoComplete="off"
                    id="threads-access-token"
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="THQVJ..."
                    type={revealed ? "text" : "password"}
                    value={accessToken}
                  />
                  <button
                    aria-label={
                      revealed ? "Hide access token" : "Reveal access token"
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
                    accessToken.trim().length === 0 ||
                    userId.trim().length === 0
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
