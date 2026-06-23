import { getSectionMeta } from "@/components/nav/sections";
import { AccountsSettings } from "@/components/settings/accounts-settings";
import { BlueskySettings } from "@/components/settings/bluesky-settings";
import { BrandKitSettings } from "@/components/settings/brand-kit-settings";
import { BridgeSettings } from "@/components/settings/bridge-settings";
import { ComposioSettings } from "@/components/settings/composio-settings";
import { SchedulerSettings } from "@/components/settings/scheduler-settings";
import { ThreadsSettings } from "@/components/settings/threads-settings";

export function SettingsPanel() {
  const { label, description } = getSectionMeta("settings");

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </header>
        <ComposioSettings />
        <BlueskySettings />
        <ThreadsSettings />
        <AccountsSettings />
        <BrandKitSettings />
        <SchedulerSettings />
        <BridgeSettings />
      </div>
    </section>
  );
}
