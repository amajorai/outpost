import { SidebarProvider } from "@repo/ui/sidebar";
import { useState } from "react";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { CommandMenu } from "@/components/nav/command-menu";
import { SectionPanel } from "@/components/nav/section-panel";
import { TitleBar } from "@/components/TitleBar";
import { useNavigationStore } from "@/stores/use-navigation-store";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export function AppShell() {
  const activeSection = useNavigationStore((s) => s.activeSection);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col bg-background">
      <TitleBar />
      <SidebarProvider className="min-h-0 flex-1">
        <div className="flex min-h-0 w-full flex-1">
          <AppSidebar onOpenCommandMenu={() => setCommandOpen(true)} />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            {/* Key on the active workspace so switching remounts the panels and
                re-runs their data-load effects, re-scoping every view (U32). */}
            <SectionPanel key={activeWorkspaceId} section={activeSection} />
          </main>
        </div>
      </SidebarProvider>
      <CommandMenu onOpenChange={setCommandOpen} open={commandOpen} />
    </div>
  );
}
