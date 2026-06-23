import { CalendarPanel } from "@/components/calendar/calendar-panel";
import { ComposerPanel } from "@/components/compose/composer-panel";
import { InboxPanel } from "@/components/inbox/inbox-panel";
import { getSectionMeta } from "@/components/nav/sections";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { TemplatesPanel } from "@/components/templates/templates-panel";
import type { NavSection } from "@/stores/use-navigation-store";

interface SectionPanelProps {
  section: NavSection;
}

export function SectionPanel({ section }: SectionPanelProps) {
  if (section === "settings") {
    return <SettingsPanel />;
  }

  if (section === "compose") {
    return <ComposerPanel />;
  }

  if (section === "calendar") {
    return <CalendarPanel />;
  }

  if (section === "inbox") {
    return <InboxPanel />;
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
