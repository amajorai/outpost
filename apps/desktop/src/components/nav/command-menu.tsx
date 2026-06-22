import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { useEffect } from "react";
import { NAV_SECTION_META } from "@/components/nav/sections";
import { useNavigationStore } from "@/stores/use-navigation-store";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const setActiveSection = useNavigationStore((s) => s.setActiveSection);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  return (
    <CommandDialog onOpenChange={onOpenChange} open={open}>
      <CommandInput placeholder="Jump to a section..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAV_SECTION_META.map(({ id, label, icon: Icon }) => (
            <CommandItem
              key={id}
              onSelect={() => {
                setActiveSection(id);
                onOpenChange(false);
              }}
              value={label}
            >
              <Icon className="text-muted-foreground" />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
