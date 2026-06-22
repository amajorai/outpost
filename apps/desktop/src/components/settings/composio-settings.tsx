import { Button } from "@repo/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import { Input } from "@repo/ui/input";
import { Check, Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useIntegrationStore } from "@/stores/use-integration-store";

export function ComposioSettings() {
  const composioConfigured = useIntegrationStore((s) => s.composioConfigured);
  const activeProviderId = useIntegrationStore((s) => s.activeProviderId);
  const isLoading = useIntegrationStore((s) => s.isLoading);
  const refresh = useIntegrationStore((s) => s.refresh);
  const saveComposioApiKey = useIntegrationStore((s) => s.saveComposioApiKey);
  const clearComposioApiKey = useIntegrationStore((s) => s.clearComposioApiKey);

  const [draftKey, setDraftKey] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      await saveComposioApiKey(draftKey);
      setDraftKey("");
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the key");
    }
  }, [draftKey, saveComposioApiKey]);

  const handleRemove = useCallback(async () => {
    setError(null);
    try {
      await clearComposioApiKey();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove the key");
    }
  }, [clearComposioApiKey]);

  const providerLabel =
    activeProviderId === "composio" ? "Composio" : "Built-in (dev) provider";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" strokeWidth={1.5} />
          Composio integration
        </CardTitle>
        <CardDescription>
          Connect your own Composio API key to publish and read engagement
          across platforms. Without a key, Outpost uses a local provider for
          development.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Active provider:</span>
          <span className="font-medium">{providerLabel}</span>
          {composioConfigured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs dark:text-emerald-400">
              <Check className="size-3" /> Key configured
            </span>
          )}
        </div>

        {composioConfigured ? (
          <div className="flex items-center gap-2">
            <Button
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
              Remove key
            </Button>
            <p className="text-muted-foreground text-xs">
              Your key is stored encrypted on this device and never leaves it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label
              className="font-medium text-sm"
              htmlFor="composio-api-key-input"
            >
              Composio API key
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  autoComplete="off"
                  id="composio-api-key-input"
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="ck_..."
                  type={revealed ? "text" : "password"}
                  value={draftKey}
                />
                <button
                  aria-label={revealed ? "Hide key" : "Reveal key"}
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
                disabled={isLoading || draftKey.trim().length === 0}
                onClick={handleSave}
                type="button"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
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
