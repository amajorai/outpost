/**
 * Auto cross-post configuration UI (U19).
 *
 * Lets the user enable auto cross-posting and pick, per detected source
 * platform -> target platform, where a manually-posted item should be
 * cross-posted. The source side is limited to the platforms the browser
 * extension can actually detect ({@link DETECTABLE_SOURCE_PLATFORMS}); the
 * target side is every supported platform other than the source.
 *
 * A prominent "require confirmation" switch (on by default) controls whether a
 * detected post is reviewed before publishing. Turning it off shows a warning,
 * because the pipeline then posts to real accounts without asking.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import { Label } from "@repo/ui/label";
import { Switch } from "@repo/ui/switch";
import { AlertTriangle, Info, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { sileo } from "sileo";
import { platformLabel } from "@/components/compose/platform-meta";
import {
  type CrossPostConfig,
  defaultCrossPostConfig,
  loadCrossPostConfig,
  saveCrossPostConfig,
} from "@/lib/cross-post/config";
import { DETECTABLE_SOURCE_PLATFORMS } from "@/lib/cross-post/types";
import { logger } from "@/lib/logger";
import type { Platform } from "@/lib/providers/types";
import { SUPPORTED_PLATFORMS } from "@/stores/use-social-accounts-store";

/** Whether a given source->target route is currently enabled in the config. */
function isRouteOn(
  config: CrossPostConfig,
  source: Platform,
  target: Platform
): boolean {
  return config.routes[source]?.[target] === true;
}

export function CrossPostSettings() {
  const [config, setConfig] = useState<CrossPostConfig>(
    defaultCrossPostConfig()
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadCrossPostConfig()
      .then((c) => {
        setConfig(c);
        setLoaded(true);
      })
      .catch((err) => {
        logger.error({ err }, "[CrossPost] Failed to load config in settings");
        setLoaded(true);
      });
  }, []);

  const persist = useCallback((next: CrossPostConfig) => {
    setConfig(next);
    saveCrossPostConfig(next).catch((err) => {
      logger.error({ err }, "[CrossPost] Failed to save config");
      sileo.error({
        title: "Couldn't save",
        description: "Your cross-post settings weren't saved.",
      } as Parameters<typeof sileo.error>[0]);
    });
  }, []);

  const handleEnabled = useCallback(
    (checked: boolean) => persist({ ...config, enabled: checked }),
    [config, persist]
  );

  const handleRequireConfirmation = useCallback(
    (checked: boolean) => persist({ ...config, requireConfirmation: checked }),
    [config, persist]
  );

  const handleRoute = useCallback(
    (source: Platform, target: Platform, checked: boolean) => {
      const sourceRow = { ...config.routes[source], [target]: checked };
      persist({
        ...config,
        routes: { ...config.routes, [source]: sourceRow },
      });
    },
    [config, persist]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="size-4" strokeWidth={1.5} />
          Auto cross-post
        </CardTitle>
        <CardDescription>
          When the browser extension detects a post you wrote manually, Outpost
          can cross-post it to your other platforms.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cross-post-enabled">Enable auto cross-post</Label>
            <p className="text-muted-foreground text-sm">
              Listen for detected posts and route them to the targets you choose
              below.
            </p>
          </div>
          <Switch
            checked={config.enabled}
            disabled={!loaded}
            id="cross-post-enabled"
            onCheckedChange={handleEnabled}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cross-post-confirm">Review before posting</Label>
            <p className="text-muted-foreground text-sm">
              Show a confirmation for each detected post before it goes out.
            </p>
          </div>
          <Switch
            checked={config.requireConfirmation}
            disabled={!(loaded && config.enabled)}
            id="cross-post-confirm"
            onCheckedChange={handleRequireConfirmation}
          />
        </div>

        {config.enabled && !config.requireConfirmation && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 text-sm dark:text-amber-400">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={1.5}
            />
            <p>
              With review turned off, detected posts are published to your real
              accounts automatically, without asking. Posts you wrote elsewhere
              will go out the moment they're detected.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {DETECTABLE_SOURCE_PLATFORMS.map((source) => {
            const targets = SUPPORTED_PLATFORMS.filter((t) => t !== source);
            return (
              <div className="flex flex-col gap-2" key={source}>
                <p className="font-medium text-sm">
                  When I post on {platformLabel(source)}, send it to:
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {targets.map((target) => {
                    const id = `route-${source}-${target}`;
                    return (
                      <div
                        className="flex items-center justify-between gap-2"
                        key={target}
                      >
                        <Label className="font-normal text-sm" htmlFor={id}>
                          {platformLabel(target)}
                        </Label>
                        <Switch
                          checked={isRouteOn(config, source, target)}
                          disabled={!(loaded && config.enabled)}
                          id={id}
                          onCheckedChange={(checked) =>
                            handleRoute(source, target, checked)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-muted-foreground text-sm">
          <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          <p>
            Cross-posting is text-only and posts to every connected account on
            the chosen platforms. Posts Outpost already scheduled or published
            are skipped automatically, so your own posts never loop back.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
