import {
  BookOpen,
  CalendarClock,
  CircleHelp,
  FileText,
  Gauge,
  Images,
  LayoutDashboard,
  Library,
  Lightbulb,
  ListChecks,
  MessageSquareQuote,
  Newspaper,
  Palette,
  PenLine,
  Play,
  Plug,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
  Target,
  UserRound,
  Users,
  Wrench,
  type LucideIcon
} from 'lucide-react'

/**
 * The icons a help page can name: in the docs sidebar (DocNavItem.icon) and
 * on cards in the pages (`icon="rocket"`). A name, so nav.ts stays plain data.
 */
export const DOC_ICONS = {
  book: BookOpen,
  rocket: Rocket,
  dashboard: LayoutDashboard,
  users: Users,
  user: UserRound,
  voice: MessageSquareQuote,
  library: Library,
  sliders: SlidersHorizontal,
  play: Play,
  target: Target,
  lightbulb: Lightbulb,
  palette: Palette,
  newspaper: Newspaper,
  steps: ListChecks,
  post: FileText,
  pen: PenLine,
  images: Images,
  calendar: CalendarClock,
  shield: ShieldCheck,
  plug: Plug,
  theme: SunMoon,
  gauge: Gauge,
  wrench: Wrench,
  help: CircleHelp,
  sparkles: Sparkles
} satisfies Record<string, LucideIcon>

export type DocIconName = keyof typeof DOC_ICONS

export function isDocIconName(name: unknown): name is DocIconName {
  return typeof name === 'string' && Object.hasOwn(DOC_ICONS, name)
}
