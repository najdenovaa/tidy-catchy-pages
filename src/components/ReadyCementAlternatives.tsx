import { useState } from "react";
import { ExternalLink, Factory, Info, Layers, ChevronDown } from "lucide-react";

export interface ReadyCementSystem {
  id: string;
  name: string;
  title: string;
  purpose: string;
  densityMin: number;
  densityMax: number;
  tempMin: number;
  tempMax: number;
  url: string;
  note: string;
}

// Values are published *product-family ranges*, not guaranteed job-specific
// specifications. Never use these values in hydraulic/material calculations.
export const NEFTESERVIS_SYSTEMS: ReadyCementSystem[] = [
  {
    id: "ocs", name: "ОЦС", title: "Облегчённая цементная система",
    purpose: "Пониженная плотность, высокая ранняя прочность, сокращение ОЗЦ",
    densityMin: 1.0, densityMax: 1.7, tempMin: 20, tempMax: 130,
    url: "https://nefteserv.ru/lightcem",
    note: "Прочность 24 ч при 60 °C: не менее 6,9 МПа (данные производителя)",
  },
  {
    id: "acs", name: "АЦС", title: "Арктическая цементная система",
    purpose: "Многолетнемёрзлые породы и холодные интервалы",
    densityMin: 1.4, densityMax: 1.9, tempMin: -5, tempMax: 20,
    url: "https://nefteserv.ru/arcticcem",
    note: "Для ММП; прочность 24 ч при 5 °C: не менее 4 МПа",
  },
  {
    id: "kcs", name: "КЦС", title: "Компрессионная цементная система",
    purpose: "Риск заколонных перетоков и миграции флюидов",
    densityMin: 1.7, densityMax: 2.0, tempMin: 16, tempMax: 100,
    url: "https://nefteserv.ru/extendcem-g",
    note: "Заявленное расширение цементного камня: 1,5–5%",
  },
  {
    id: "ecs", name: "ЭЦС", title: "Эластичная цементная система",
    purpose: "Циклические нагрузки, опрессовки, перфорация и МГРП",
    densityMin: 1.8, densityMax: 2.0, tempMin: 15, tempMax: 150,
    url: "https://nefteserv.ru/flexicem",
    note: "Заявленный модуль Юнга: 1,5–7 ГПа",
  },
  {
    id: "svc", name: "СВЦ", title: "Самовосстанавливающаяся цементная система",
    purpose: "Микротрещины, микрозазоры и длительная герметичность в углеводородной среде",
    densityMin: 1.4, densityMax: 2.1, tempMin: 5, tempMax: 150,
    url: "https://nefteserv.ru/svc",
    note: "Самовосстановление при контакте с углеводородами, по данным производителя",
  },
  {
    id: "csku", name: "ЦСКУ", title: "Коррозионно-устойчивая цементная система",
    purpose: "Сероводород, углекислый газ и агрессивная среда",
    densityMin: 1.8, densityMax: 2.0, tempMin: 15, tempMax: 110,
    url: "https://nefteserv.ru/corrosioncem",
    note: "Рабочий диапазон 15–110 °C; циклические температуры производитель оговаривает отдельно",
  },
];

type Readiness = "range" | "unknown" | "outside";
export function assessReadySystem(system: ReadyCementSystem, density: number, temperature?: number): Readiness {
  if (!(density > 0) || temperature === undefined || !Number.isFinite(temperature)) return "unknown";
  return density >= system.densityMin && density <= system.densityMax &&
    temperature >= system.tempMin && temperature <= system.tempMax ? "range" : "outside";
}

interface Props {
  densityGcm3?: number;
  temperatureC?: number;
  className?: string;
}

/** A read-only alternative catalog, with explicit engineering qualification. */
export default function ReadyCementAlternatives({ densityGcm3, temperatureC, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const validDensity = typeof densityGcm3 === "number" && Number.isFinite(densityGcm3) && densityGcm3 > 0
    ? densityGcm3 > 20 ? densityGcm3 / 1000 : densityGcm3
    : undefined;
  const validTemp = typeof temperatureC === "number" && Number.isFinite(temperatureC)
    ? temperatureC : undefined;
  const suitable = NEFTESERVIS_SYSTEMS.filter(s => validDensity !== undefined && assessReadySystem(s, validDensity, validTemp) === "range");
  const shown = showAll || suitable.length === 0 ? NEFTESERVIS_SYSTEMS : suitable;

  return (
    <section className={`rounded-xl border border-primary/25 bg-primary/[0.025] overflow-hidden ${className}`} data-testid="ready-cement-alternatives">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Factory className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Альтернатива: готовые цементные системы</span>
          <span className="hidden sm:inline rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Нефтесервис</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Готовые промышленные смеси вместо составления собственной рецептуры. Это ознакомительный подбор по опубликованным диапазонам плотности и температуры, не подтверждение пригодности для конкретной скважины.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              Условия: {validDensity !== undefined ? `${validDensity.toFixed(2)} г/см³` : "плотность не задана"}
              {" · "}{validTemp !== undefined ? `${validTemp.toFixed(0)} °C` : "температура не задана"}
            </span>
            {suitable.length > 0 && (
              <button type="button" className="text-primary hover:underline font-medium" onClick={() => setShowAll(v => !v)}>
                {showAll ? "Показать совпадения по диапазонам" : `Все системы (${NEFTESERVIS_SYSTEMS.length})`}
              </button>
            )}
          </div>
          {suitable.length === 0 && <p className="text-xs text-amber-700 dark:text-amber-400">
            {validDensity === undefined || validTemp === undefined
              ? "Для предварительного сопоставления задайте плотность и температуру раствора."
              : "По двум заданным параметрам совпадений не найдено. Ниже показан полный каталог для ознакомления."}
          </p>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {shown.map(system => {
              const status = assessReadySystem(system, validDensity ?? 0, validTemp);
              return (
                <article key={system.id} className="rounded-lg border border-border bg-card p-3 space-y-2 min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{system.name} <span className="font-normal text-muted-foreground">· Нефтесервис</span></p>
                      <p className="text-xs text-foreground/90">{system.title}</p>
                    </div>
                    {status === "range" && <span className="text-[10px] rounded-md bg-primary/10 text-primary px-2 py-1">В пределах диапазонов</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{system.purpose}</p>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded bg-muted px-2 py-1"><Layers className="w-3 h-3 inline mr-1" />{system.densityMin.toFixed(1)}–{system.densityMax.toFixed(1)} г/см³</span>
                    <span className="rounded bg-muted px-2 py-1">{system.tempMin}…{system.tempMax} °C</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{system.note}</p>
                  <a href={system.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Описание производителя <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </article>
              );
            })}
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Подбор по диапазонам не учитывает реологию, водоотдачу, совместимость с флюидами, время загустевания и набор прочности. Паспорт конкретной рецептуры и лабораторные испытания обязательны. Никакие данные из карточек не подставляются в расчёт автоматически.
          </p>
          <p className="text-[11px] text-muted-foreground">
            <a className="text-primary hover:underline" href="https://nefteserv.ru/" target="_blank" rel="noopener noreferrer">ООО «Нефтесервис»</a>
            {" · "}Каталог партнёра. Характеристики приведены по страницам производителя.
          </p>
        </div>
      )}
    </section>
  );
}
