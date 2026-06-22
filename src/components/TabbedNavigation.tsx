import { useMemo } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, BarChart3, Film } from "lucide-react";
import { cn } from "@/lib/utils";

interface TabItem {
  value: string;
  label: string;
}

interface TabGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tabs: TabItem[];
}

const GROUPS: TabGroup[] = [
  {
    id: "input",
    label: "Ввод",
    icon: ClipboardList,
    tabs: [
      { value: "input", label: "Данные" },
      { value: "centralization", label: "Центрация (со спуском)" },
      { value: "foam", label: "Пена" },
      { value: "rotation", label: "Вращение" },
    ],
  },
  {
    id: "analysis",
    label: "Анализ",
    icon: BarChart3,
    tabs: [
      { value: "charts", label: "Графики" },
      { value: "trajectory", label: "Траектория" },
      { value: "materials", label: "Материалы" },
      { value: "schedule", label: "Закачка" },
      { value: "hydraulics", label: "Гидравлика" },
      { value: "contact", label: "Контакт" },
      { value: "quality", label: "Качество (CQI)" },
      { value: "torquedrag", label: "T&D" },
      { value: "drillhydr", label: "Гидравлика бурения" },
    ],
  },
  {
    id: "visual",
    label: "Визуализация",
    icon: Film,
    tabs: [
      { value: "animation", label: "Анимация" },
      { value: "visual", label: "Визуализация" },
    ],
  },
];

interface Props {
  activeTab: string;
  onTabChange: (val: string) => void;
}

export default function TabbedNavigation({ activeTab, onTabChange }: Props) {
  const activeGroup = useMemo(
    () => GROUPS.find((g) => g.tabs.some((t) => t.value === activeTab)) ?? GROUPS[0],
    [activeTab],
  );

  return (
    <div className="sticky top-[80px] sm:top-[164px] z-[9] bg-background border-b border-border">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-2 space-y-2">
        {/* Group switcher */}
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            const isActive = g.id === activeGroup.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  if (!g.tabs.some((t) => t.value === activeTab)) {
                    onTabChange(g.tabs[0].value);
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md-1"
                    : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="uppercase tracking-wide">{g.label}</span>
                <span className={cn("text-[10px] opacity-70", isActive && "opacity-90")}>
                  {g.tabs.length}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sub-tabs of active group */}
        <div className="overflow-x-auto scrollbar-hide">
          <TabsList className="inline-flex w-max h-auto min-w-max">
            {activeGroup.tabs.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="text-xs py-2 px-3"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
    </div>
  );
}
