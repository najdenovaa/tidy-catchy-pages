import { useMemo } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, BarChart3, Film, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TabItem {
  value: string;
  label: string;
  /** Подгруппа: между подгруппами ставится разделитель */
  section?: string;
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
      { value: "woc", label: "ОЗЦ" },
    ],
  },
  {
    id: "analysis",
    label: "Анализ",
    icon: BarChart3,
    tabs: [
      { value: "charts", label: "Графики", section: "Расчёт" },
      { value: "trajectory", label: "Траектория", section: "Расчёт" },
      { value: "hydraulics", label: "Гидравлика", section: "Расчёт" },
      { value: "schedule", label: "Закачка", section: "Расчёт" },
      { value: "materials", label: "Материалы", section: "Расчёт" },
      { value: "lab", label: "Лаборатория и рецептура", section: "Подготовка" },
      { value: "norms", label: "Нормы и риски", section: "Подготовка" },
      { value: "logistics", label: "Техника", section: "Подготовка" },
      { value: "contact", label: "Контакт", section: "Качество" },
      { value: "quality", label: "Качество (CQI)", section: "Качество" },
      { value: "skc", label: "Контроль СКЦ", section: "Качество" },
      { value: "torquedrag", label: "T&D", section: "Бурение" },
      { value: "drillhydr", label: "Гидравлика бурения", section: "Бурение" },
    ],
  },
  {
    id: "visual",
    label: "Визуализация",
    icon: Film,
    tabs: [
      { value: "animation", label: "Анимация" },
      { value: "displace3d", label: "Вытеснение 3D" },
      { value: "visual", label: "Визуализация" },
    ],
  },
  {
    id: "optimizer",
    label: "Автоподбор",
    icon: Wand2,
    tabs: [{ value: "optimizer", label: "Автоподбор программы" }],
  },
];

interface Props {
  activeTab: string;
  onTabChange: (val: string) => void;
  rightSlot?: React.ReactNode;
}

export default function TabbedNavigation({ activeTab, onTabChange, rightSlot }: Props) {
  const activeGroup = useMemo(
    () => GROUPS.find((g) => g.tabs.some((t) => t.value === activeTab)) ?? GROUPS[0],
    [activeTab],
  );

  const sections = useMemo(() => {
    const out: { name: string; tabs: TabItem[] }[] = [];
    activeGroup.tabs.forEach((t) => {
      const name = t.section ?? "";
      if (!out.length || out[out.length - 1].name !== name) out.push({ name, tabs: [] });
      out[out.length - 1].tabs.push(t);
    });
    return out;
  }, [activeGroup]);

  return (
    <div className="relative sm:sticky sm:top-[164px] z-[9] bg-background border-b border-border">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-2 space-y-2">
        {/* Светофор сверху во всю ширину */}
        {rightSlot && <div className="w-full">{rightSlot}</div>}

        {/* Группы — первая строка, подвкладки — под ними во всю ширину */}
        <div className="flex flex-col gap-2">
          {/* Group switcher */}
          <div className="flex flex-wrap gap-1">
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
                  {g.tabs.length > 1 && (
                    <span className={cn("text-[10px] opacity-70", isActive && "opacity-90")}>
                      {g.tabs.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Подвкладки переносятся по строкам: всё видно без прокрутки; подгруппы не разрываются */}
          <div className={cn("w-full", activeGroup.tabs.length === 1 && "hidden")}>
            <TabsList className="flex flex-wrap justify-start items-center w-full h-auto gap-y-1 gap-x-1 p-1">
              {sections.map((sec, si) => (
                <div key={sec.name || si} className={cn("flex flex-wrap items-center", si > 0 && "sm:pl-2 sm:ml-1 sm:border-l border-border/70")}>
                  {sec.name && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 px-1">{sec.name}</span>}
                  {sec.tabs.map((t) => (
                    <TabsTrigger key={t.value} value={t.value} className="text-xs py-1.5 px-2.5">
                      {t.label}
                    </TabsTrigger>
                  ))}
                </div>
              ))}
            </TabsList>
          </div>
        </div>
      </div>
    </div>
  );
}
