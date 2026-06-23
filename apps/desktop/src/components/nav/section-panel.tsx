import { ActivityPanel } from "@/components/activity/activity-panel";
import { AutoresearchPanel } from "@/components/autoresearch/autoresearch-panel";
import { CalendarPanel } from "@/components/calendar/calendar-panel";
import { ComposerPanel } from "@/components/compose/composer-panel";
import { ExperimentsPanel } from "@/components/experiments/experiments-panel";
import { InboxPanel } from "@/components/inbox/inbox-panel";
import { getSectionMeta } from "@/components/nav/sections";
import { RadarPanel } from "@/components/radar/radar-panel";
import { RepurposePanel } from "@/components/repurpose/repurpose-panel";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { TemplatesPanel } from "@/components/templates/templates-panel";
import { WarRoomPanel } from "@/components/war-room/war-room-panel";
import type { NavSection } from "@/stores/use-navigation-store";

interface SectionPanelProps {
  section: NavSection;
}

export function SectionPanel({ section }: SectionPanelProps) {
  if (section === "war-room") {
    return <WarRoomPanel />;
  }

  if (section === "settings") {
    return <SettingsPanel />;
  }

  if (section === "compose") {
    return <ComposerPanel />;
  }

  if (section === "repurpose") {
    return <RepurposePanel />;
  }

  if (section === "calendar") {
    return <CalendarPanel />;
  }

  if (section === "inbox") {
    return <InboxPanel />;
  }

  if (section === "activity") {
    return <ActivityPanel />;
  }

  if (section === "experiments") {
    return <ExperimentsPanel />;
  }

  if (section === "autoresearch") {
    return <AutoresearchPanel />;
  }

  if (section === "radar") {
    return <RadarPanel />;
  }

  if (section === "templates") {
    return <TemplatesPanel />;
  }

  const { label, description, icon: Icon } = getSectionMeta(section);

  return (
    <section className="flex min-h-0 flex-1 items-center justify-center px-8 py-16">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="size-6" strokeWidth={1.5} />
        </div>
        <h1 className="font-semibold text-2xl tracking-tight">{label}</h1>
        <p className="text-balance text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>
      </div>
    </section>
  );
}
