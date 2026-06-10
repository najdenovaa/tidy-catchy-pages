import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Check, AlertTriangle, RotateCw, Wind } from "lucide-react";
import { CT_OPERATIONS, type CTOperation, lpmToLps } from "@/lib/ct-operations";

interface Props {
  selectedType?: string;
  onSelect: (op: CTOperation, applyParams: {
    flowRateLps: number;
    fluidDensityGcc: number;
  }) => void;
}

const CATEGORIES: CTOperation["category"][] = [
  "Промывка/чистка",
  "Стимуляция",
  "Цемент/механика",
  "Газовые",
  "Сервис",
];

export default function CTOperationsLibrary({ selectedType, onSelect }: Props) {
  const [open, setOpen] = useState(true);
  const [activeCat, setActiveCat] = useState<CTOperation["category"] | "all">("all");

  const grouped = useMemo(() => {
    const list = activeCat === "all" ? CT_OPERATIONS : CT_OPERATIONS.filter(o => o.category === activeCat);
    return list;
  }, [activeCat]);

  const selected = CT_OPERATIONS.find(o => o.type === selectedType);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              🎯 Библиотека операций ГНКТ
              {selected && (
                <Badge variant="secondary" className="text-[10px]">
                  {selected.icon} {selected.nameRu}
                </Badge>
              )}
            </CardTitle>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {/* Фильтр категорий */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <CategoryChip active={activeCat === "all"} onClick={() => setActiveCat("all")}>
                Все
              </CategoryChip>
              {CATEGORIES.map(c => (
                <CategoryChip key={c} active={activeCat === c} onClick={() => setActiveCat(c)}>
                  {c}
                </CategoryChip>
              ))}
            </div>

            {/* Сетка операций */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {grouped.map(op => {
                const isActive = op.type === selectedType;
                const midFlow = (op.recommendedFlowRateLpm[0] + op.recommendedFlowRateLpm[1]) / 2;
                return (
                  <button
                    key={op.type}
                    onClick={() =>
                      onSelect(op, {
                        flowRateLps: lpmToLps(midFlow),
                        fluidDensityGcc: op.recommendedFluidDensity,
                      })
                    }
                    className={`text-left rounded-lg border p-3 transition-all relative ${
                      isActive
                        ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                        : "border-border bg-card hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    {isActive && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-3 h-3 text-primary-foreground" />
                      </div>
                    )}
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="text-xl leading-none">{op.icon}</span>
                      <div className="flex-1 pr-5">
                        <h4 className="font-semibold text-xs leading-tight">{op.nameRu}</h4>
                        <div className="flex gap-1 flex-wrap mt-1">
                          {op.requiresRotation && (
                            <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0">
                              <RotateCw className="w-2.5 h-2.5" /> Вращение
                            </Badge>
                          )}
                          {op.requiresNitrogen && (
                            <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0">
                              <Wind className="w-2.5 h-2.5" /> N₂
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                      {op.description}
                    </p>
                    <div className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
                      <div>
                        Жидкость: <span className="text-foreground">{op.recommendedFluid}</span>
                      </div>
                      <div>
                        Q: <span className="text-foreground font-mono">
                          {op.recommendedFlowRateLpm[0]}–{op.recommendedFlowRateLpm[1]} л/мин
                        </span>
                      </div>
                      <div>
                        P: <span className="text-foreground font-mono">
                          {op.recommendedSurfacePressureMPa[0]}–{op.recommendedSurfacePressureMPa[1]} МПа
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Подробности выбранной операции */}
            {selected && selected.type !== "custom" && (
              <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-2">
                      <span className="text-lg">{selected.icon}</span>
                      {selected.nameRu}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Категория: {selected.category}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">Активна</Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Типичная КНБК
                    </div>
                    <ul className="space-y-0.5">
                      {selected.typicalBHA.map((b, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-primary mt-0.5">▸</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-500" /> Типовые риски
                    </div>
                    <ul className="space-y-0.5">
                      {selected.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-amber-500 mt-0.5">⚠</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 italic">
                  При клике на карточку в параметры подставлены: расход (середина диапазона)
                  и плотность рабочей жидкости. Остальные параметры — вручную.
                </p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function CategoryChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card text-muted-foreground border-border hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );
}
