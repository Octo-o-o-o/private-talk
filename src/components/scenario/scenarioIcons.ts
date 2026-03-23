import {
  Book,
  BookOpen,
  Bot,
  Brain,
  BriefcaseMedical,
  Code,
  Gamepad2,
  GraduationCap,
  Heart,
  Languages,
  Lightbulb,
  MessageCircle,
  Mic,
  Music,
  Pen,
  Search,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export const SCENARIO_ICONS: Record<string, LucideIcon> = {
  "message-circle": MessageCircle,
  "heart": Heart,
  "gamepad-2": Gamepad2,
  "languages": Languages,
  "code": Code,
  "pen": Pen,
  "graduation-cap": GraduationCap,
  "brain": Brain,
  "lightbulb": Lightbulb,
  "search": Search,
  "bot": Bot,
  "mic": Mic,
  "music": Music,
  "book": Book,
  "book-open": BookOpen,
  "briefcase-medical": BriefcaseMedical,
  "shield": Shield,
  "sparkles": Sparkles,
};

export function getScenarioIcon(name: string): LucideIcon | null {
  return SCENARIO_ICONS[name] ?? null;
}
