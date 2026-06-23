import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import { Label } from "@repo/ui/label";
import { Switch } from "@repo/ui/switch";
import { CalendarClock, Info } from "lucide-react";
import { useCallback } from "react";
import { useAppSettingsStore } from "@/stores/use-app-settings-store";

export function SchedulerSettings() {
  const autostartEnabled = useAppSettingsStore((s) => s.autostartEnabled);
  const setAutostartEnabled = useAppSettingsStore((s) => s.setAutostartEnabled);

  const handleToggle = useCallback(
    (checked: boolean) => {
      setAutostartEnabled(checked).catch(() => {
        // setAutostartEnabled handles and logs its own errors
      });
    },
    [setAutostartEnabled]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" strokeWidth={1.5} />
          Scheduling
        </CardTitle>
        <CardDescription>
          Outpost publishes scheduled posts locally, from this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="autostart-toggle">Launch on login</Label>
            <p className="text-muted-foreground text-sm">
              Start Outpost automatically when you sign in, so scheduled posts
              go out on time without opening the app manually.
            </p>
          </div>
          <Switch
            checked={autostartEnabled}
            id="autostart-toggle"
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 text-sm dark:text-amber-400">
          <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
          <p>
            Scheduled posts only go out while Outpost is running. There is no
            cloud worker: if the app is closed at a post's scheduled time, it
            publishes as soon as you next open the app. Keep Outpost running, or
            enable launch on login, so posts fire on schedule.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
