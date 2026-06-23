import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/sidebar";
import { Search } from "lucide-react";
import { NAV_SECTION_META } from "@/components/nav/sections";
import { WorkspaceSwitcher } from "@/components/nav/workspace-switcher";
import { useNavigationStore } from "@/stores/use-navigation-store";

const MAC_PLATFORM_REGEX = /Mac/;

interface AppSidebarProps {
  onOpenCommandMenu: () => void;
}

export function AppSidebar({ onOpenCommandMenu }: AppSidebarProps) {
  const activeSection = useNavigationStore((s) => s.activeSection);
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);
  const shortcutLabel = MAC_PLATFORM_REGEX.test(navigator.userAgent)
    ? "⌘K"
    : "Ctrl K";

  return (
    <Sidebar
      className="w-56 border-sidebar-border border-r bg-sidebar/60"
      collapsible="none"
    >
      <SidebarContent className="gap-1 px-2 pt-3">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <WorkspaceSwitcher />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <button
              className="flex w-full items-center gap-2 rounded-xl border border-sidebar-border bg-background/40 px-3 py-2 text-left text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={onOpenCommandMenu}
              type="button"
            >
              <Search className="size-4 shrink-0" />
              <span className="flex-1">Search</span>
              <kbd className="font-medium text-muted-foreground text-xs tracking-wide">
                {shortcutLabel}
              </kbd>
            </button>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_SECTION_META.map(({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={activeSection === id}
                    onClick={() => setActiveSection(id)}
                  >
                    <Icon strokeWidth={1.75} />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
