/**
 * Autopilot autonomy settings card (U30).
 *
 * Persists how much the crew orchestrator may act on its own. The three levels
 * are a segmented control:
 *  - Suggest only: show the plan; never queue.
 *  - Approve each (DEFAULT): every queued action needs explicit per-action
 *    approval before it touches a real account.
 *  - Full auto: queue + schedule without prompting.
 *
 * CRITICAL SAFETY: full auto is OFF by default and can only be enabled through an
 * explicit, confirmed opt-in — selecting it does NOT flip the setting; it opens a
 * confirmation Dialog that states plainly it posts to real public accounts, and
 * the level only changes once the user confirms. Cancelling leaves the previous
 * (safe) level untouched. Switching to the other two levels is immediate (they
 * never auto-post).
 */

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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { AlertTriangle, Bot } from "lucide-react";
import { useCallback, useState } from "react";
import type { AutopilotAutonomy } from "@/lib/social-schema";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

const LEVELS: {
  value: AutopilotAutonomy;
  label: string;
  description: string;
}[] = [
  {
    value: "suggest",
    label: "Suggest only",
    description: "Show the proposed plan. Nothing is queued for you.",
  },
  {
    value: "approve-each",
    label: "Approve each",
    description:
      "Each proposed post needs your explicit approval before it is queued.",
  },
  {
    value: "full-auto",
    label: "Full auto",
    description:
      "Queue and schedule proposed posts automatically, with no prompt.",
  },
];

export function AutopilotSettings() {
  const autonomy = useAppSettingsStore((s) => s.autopilotAutonomy);
  const setAutonomy = useAppSettingsStore((s) => s.setAutopilotAutonomy);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleSelect = useCallback(
    (level: AutopilotAutonomy) => {
      if (level === autonomy) {
        return;
      }
      // Full auto can only be turned on via the explicit confirmation Dialog —
      // selecting it does NOT change the setting here.
      if (level === "full-auto") {
        setConfirmOpen(true);
        return;
      }
      setAutonomy(level).catch(() => {
        // setAutonomy handles and logs its own errors.
      });
    },
    [autonomy, setAutonomy]
  );

  const confirmFullAuto = useCallback(() => {
    setAutonomy("full-auto")
      .catch(() => {
        // setAutonomy handles and logs its own errors.
      })
      .finally(() => setConfirmOpen(false));
  }, [setAutonomy]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" strokeWidth={1.5} />
          Autopilot
        </CardTitle>
        <CardDescription>
          How much the crew orchestrator may act on its own when it plans your
          week.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {LEVELS.map((level) => {
          const isActive = level.value === autonomy;
          return (
            <button
              className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
              key={level.value}
              onClick={() => handleSelect(level.value)}
              type="button"
            >
              <span className="flex items-center gap-2 font-medium text-sm">
                {level.label}
                {isActive ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 font-normal text-[10px] text-primary-foreground">
                    Active
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-sm">
                {level.description}
              </span>
            </button>
          );
        })}

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 text-sm dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          <p>
            Full auto posts to your real, public accounts without asking. It is
            off by default. Leave it on Approve each unless you are sure.
          </p>
        </div>
      </CardContent>

      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Turn on full auto?
            </DialogTitle>
            <DialogDescription>
              In full auto, the crew orchestrator queues and schedules the posts
              it plans <strong>without asking you first</strong>. These go out
              to your real, public social accounts. You can still cancel queued
              posts from the calendar before they publish.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row sm:justify-end">
            <Button
              onClick={() => setConfirmOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmFullAuto}
              type="button"
              variant="destructive"
            >
              Yes, post automatically
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
