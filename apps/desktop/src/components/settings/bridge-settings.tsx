/**
 * Local bridge token settings (security hardening).
 *
 * Outpost runs a privileged HTTP bridge on 127.0.0.1:37842 that the local MCP
 * proxy and the browser extension call. To stop any web page from driving it,
 * every request must carry a per-install secret token. This card surfaces that
 * token (read-only) so the user can copy it into the extension popup. The MCP
 * server reads the same token from ~/.outpost/bridge-token automatically.
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
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { logger } from "@/lib/logger";

export function BridgeSettings() {
  const [token, setToken] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<string>("get_bridge_token")
      .then(setToken)
      .catch((err) => {
        logger.error({ err }, "[Bridge] Failed to load token");
      });
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      logger.error({ err }, "[Bridge] Failed to copy token");
    }
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" strokeWidth={1.5} />
          Browser extension
        </CardTitle>
        <CardDescription>
          Copy this token into the Outpost browser extension popup so it can
          deliver detected posts to this app. The local MCP server reads the
          same token automatically. Keep it private: anything with this token
          can drive Outpost on this machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="font-medium text-sm" htmlFor="bridge-token">
          Bridge token
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              id="bridge-token"
              readOnly
              type={revealed ? "text" : "password"}
              value={token}
            />
            <button
              aria-label={revealed ? "Hide token" : "Reveal token"}
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
            disabled={token.length === 0}
            onClick={handleCopy}
            type="button"
            variant="secondary"
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
