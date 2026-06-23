import {
  Activity,
  CalendarDays,
  Inbox,
  type LucideIcon,
  PenLine,
  Scissors,
  Settings,
  Swords,
  Wand2,
} from "lucide-react";
import type { NavSection } from "@/stores/use-navigation-store";

export interface NavSectionMeta {
  id: NavSection;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const NAV_SECTION_META: NavSectionMeta[] = [
  {
    id: "war-room",
    label: "War Room",
    description: "Your command center for everything in flight.",
    icon: Swords,
  },
  {
    id: "compose",
    label: "Compose",
    description: "Draft and shape your next post.",
    icon: PenLine,
  },
  {
    id: "repurpose",
    label: "Repurpose",
    description: "Atomize long-form content into platform-native posts.",
    icon: Scissors,
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Plan and schedule what goes out, and when.",
    icon: CalendarDays,
  },
  {
    id: "inbox",
    label: "Inbox",
    description: "Replies, mentions, and conversations in one place.",
    icon: Inbox,
  },
  {
    id: "activity",
    label: "Activity",
    description: "A clean timeline of what has happened.",
    icon: Activity,
  },
  {
    id: "templates",
    label: "Templates",
    description: "Reusable starting points for faster writing.",
    icon: Wand2,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Tune Outpost to the way you work.",
    icon: Settings,
  },
];

export function getSectionMeta(id: NavSection): NavSectionMeta {
  const meta = NAV_SECTION_META.find((section) => section.id === id);
  if (!meta) {
    throw new Error(`Unknown navigation section: ${id}`);
  }
  return meta;
}
