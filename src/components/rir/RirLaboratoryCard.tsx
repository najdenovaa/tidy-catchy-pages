import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CompositionKind } from "@/lib/rir-calculations";
import type { CompositionDesign } from "@/lib/rir-compositions";
import {
  createRirLab, evaluateRirLab, recipeKey, recipeMass, buildRirLabProtocol,
  type RirLabDraft, type RirLabContext, type RirLabFacts,
} from "@/lib/rir-laboratory";
import { exportLabProtocolDocx } from "@/lib/export-lab-protocol-docx";
const inputClass = "w-full min-w-0 rounded border bg-background p-2 text-xs";
const f = (n: number, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : "-";
function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return <label className="min-w-0 text-xs"><span>{label}</span><input className={inputClass}
    aria-label={label} inputMode="decimal" value={text} placeholder="Не измерено / не задано"
    onChange={e => setText(e.target.value)}
    onBlur={() => {
      if (!text.trim()) { onChange(null); return; }
      const n = Number(text.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) onChange(n);
      else setText(value === null ? "" : String(value));
    }} /></label>;
}
export default function RirLaboratoryCard({ kind, design, draft, context, totalM3, onChange }: {
  kind: CompositionKind; design: CompositionDesign; draft?: RirLabDraft;
  context: RirLabContext; totalM3: number; onChange: (d: RirLabDraft) => void;
}) {
  const [error, setError] = useState("");
  if (!draft) return <Card data-testid="rir-laboratory"><CardHeader><CardTitle className="text-sm">
    РИР: рецептура и лабораторные испытания</CardTitle></CardHeader><CardContent className="space-y-2 text-xs">
    <p>Создайте отдельную пробу из стартовой рецептуры. Испытания, марки и партии сохраняются внутри текущей технологии РИР.</p>
    {kind === "resin_micro" ? <p>Комбинированная система требует отдельных проб смолы и микроцемента. Выберите каждый состав и заведите его пробу отдельно. Единый протокол смеси к двум фазам не применяется.</p> :
    <Button onClick={() => onChange(createRirLab(kind, design, context))}>Создать пробу РИР</Button>}
  </CardContent></Card>;
  const d = draft, e = evaluateRirLab(d, context), mass = recipeMass(d);
  const set = (p: Partial<RirLabDraft>) => {
    const binding = "testedKey" in p || "appliedKey" in p;
    const affectsTest = ["facts", "ingredients", "protocol", "laboratory", "operator", "date", "bhctC", "bhstC", "pressureMPa", "compatibility", "slotResult", "notes"].some(k => k in p);
    onChange({ ...d, ...(affectsTest && !binding ? { testedKey: undefined, appliedKey: undefined } : {}), ...p });
  };
  const setFact = (key: keyof RirLabFacts, v: number | null) => set({ facts: { ...d.facts, [key]: v } });
  const operationFactor = totalM3 * (1 + d.reservePct / 100);
  const fields: [keyof RirLabFacts, string][] = [
    ["density", "Плотность (факт), г/см³"], ["pv", kind === "resin" ? "Вязкость при BHCT (факт), мПа·с" : "ПВ при BHCT (факт), мПа·с"],
    ["yp", "ДНС при BHCT (факт), Па"],
    ["workLifeMin", kind === "resin" ? "Время жизни до геля (факт), мин" : "Время до 70 Bc (факт), мин"],
    ["fluidLossMl", "Водоотдача (факт), мл/30 мин"], ["freeWaterPct", "Свободная вода (факт), %"],
    ["sedimentationDelta", "Δρ верх-низ после выдержки (факт), г/см³"],
    ["strengthMPa", "Прочность (факт), МПа"], ["strengthAgeH", "Возраст образца прочности, ч"],
  ];
  return <Card className="min-w-0 max-w-full" data-testid="rir-laboratory">
    <CardHeader><CardTitle className="text-sm">РИР: рецептура и лабораторные испытания</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-xs">
      <p className="rounded border p-2">{e.status}. Требуемое время работы состава ≥ {context.requiredMin} мин.
        {e.applied ? " Измеренные свойства применены в расчёте." : " В расчёте используются исходные свойства, лабораторные данные не применены."}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>Название пробы<input aria-label="Название пробы РИР" className={inputClass} value={d.title} onChange={v => set({ title: v.target.value })} /></label>
        {(["protocol", "laboratory", "operator", "date"] as const).map((key, i) => <label key={key}>
          {["Номер протокола", "Лаборатория", "Исполнитель", "Дата испытаний"][i]}
          <input className={inputClass} aria-label={["Номер протокола РИР", "Лаборатория РИР", "Исполнитель РИР", "Дата испытаний РИР"][i]}
            type={key === "date" ? "date" : "text"} value={d[key]} onChange={v => set({ [key]: v.target.value })} /></label>)}
      </div>
      <details open><summary className="font-semibold cursor-pointer">1. Фактическая рецептура и расход материалов</summary>
        <p className="my-2">Массовые части - единая база для всех компонентов, включая воду. SG - плотность компонента, г/см³.
          Расчётная плотность по абсолютным объёмам: <b>{f(mass.density)} г/см³</b>.</p>
        <div className="overflow-x-auto"><table className="w-full text-xs" style={{ minWidth: 620 }}><thead><tr>
          {["Марка компонента", "Партия / вода", "Масс. части", "SG", "кг/м³", "Проба, г", "Операция, кг", ""].map((x, i) => <th key={i}>{x}</th>)}
        </tr></thead><tbody>{mass.rows.map((x, i) => {
          const row = (p: Partial<typeof x>) => set({ ingredients: d.ingredients.map((a, k) => k === i ? { ...a, ...p } : a) });
          return <tr key={i}><td><input className={inputClass} aria-label={"Компонент " + (i + 1)} value={x.name} onChange={v => row({ name: v.target.value })} /></td>
            <td><input className={inputClass} aria-label={"Партия " + (i + 1)} value={x.batch} onChange={v => row({ batch: v.target.value })} /></td>
            <td><NumberField key={"p" + i + x.parts} label={"Масса " + (i + 1)} value={x.parts} onChange={v => row({ parts: v ?? 0 })} /></td>
            <td><NumberField key={"sg" + i + x.sg} label={"SG " + (i + 1)} value={x.sg} onChange={v => row({ sg: v ?? 0 })} /></td>
            <td>{f(x.kgPerM3)}</td><td>{f(x.kgPerM3 * d.sampleVolumeL)}</td><td>{f(x.kgPerM3 * operationFactor)}</td>
            <td><Button size="sm" variant="outline" aria-label={"Удалить компонент " + (i + 1)} onClick={() => set({ ingredients: d.ingredients.filter((_, k) => k !== i) })}>×</Button></td>
          </tr>;
        })}</tbody></table></div>
        <div className="flex flex-wrap gap-2 my-2"><Button variant="outline" onClick={() => set({ ingredients: [...d.ingredients, { name: "Добавка", batch: "", role: "additive", parts: 1, sg: 1 }] })}>Добавить компонент</Button>
          <NumberField key={"sample" + d.sampleVolumeL} label="Объём лабораторной пробы, л" value={d.sampleVolumeL} onChange={v => set({ sampleVolumeL: v ?? 1 })} />
          <NumberField key={"reserve" + d.reservePct} label="Запас материалов, %" value={d.reservePct} onChange={v => set({ reservePct: v ?? 0 })} /></div>
        <p>Объём операции: {f(totalM3)} м³; запас материалов {f(d.reservePct, 0)}% учитывается только в закупке и приготовлении, объём размещения не увеличивается.</p>
      </details>
      <details open><summary className="font-semibold cursor-pointer">2. Условия и измеренные свойства</summary>
        <div className="grid gap-2 sm:grid-cols-3 my-2">
          <NumberField key={"bhct" + d.bhctC} label="BHCT испытания, °C" value={d.bhctC} onChange={v => set({ bhctC: v ?? 0 })} />
          <NumberField key={"bhst" + d.bhstC} label="BHST твердения, °C" value={d.bhstC} onChange={v => set({ bhstC: v ?? 0 })} />
          <NumberField key={"pressure" + d.pressureMPa} label="Давление испытания, МПа" value={d.pressureMPa} onChange={v => set({ pressureMPa: v })} />
          {fields.map(([key, label]) => <NumberField key={key + String(d.facts[key])} label={label} value={d.facts[key]} onChange={v => setFact(key, v)} />)}
        </div>
        <p>Условия скважины: BHCT {f(context.bhctC, 1)} °C, BHST {f(context.bhstC, 1)} °C.
          Расхождение более 2 °C требует новой проверки применимости. Давление и температурный график испытания фиксируются по принятой методике.</p>
        {!e.conditions && <Button variant="outline" onClick={() => set({ bhctC: context.bhctC, bhstC: context.bhstC, testedKey: undefined, appliedKey: undefined })}>
          Обновить условия пробы (испытания потребуют повторной привязки)</Button>}
      </details>
      <details><summary className="font-semibold cursor-pointer">3. Требования программы испытаний</summary>
        <p>Предельные значения задаёт технолог. Отсутствующее требование не считается выполненным.</p>
        <div className="grid gap-2 sm:grid-cols-3 my-2">
          {(["fluidLossMax", "freeWaterMax", "strengthMin", "strengthAgeH", "sedimentationMax"] as const).map((key, i) =>
            <NumberField key={key + d.targets[key]} label={["Водоотдача не более, мл/30 мин", "Свободная вода не более, %", "Прочность не менее, МПа", "Возраст требуемой прочности, ч", "Δρ не более, г/см³"][i]}
              value={d.targets[key]} onChange={v => set({ targets: { ...d.targets, [key]: v } })} />)}
        </div>
      </details>
      <details open><summary className="font-semibold cursor-pointer">4. Проходимость и совместимость для РИР</summary>
        <p>Приёмистость воды не доказывает проходимость цементных частиц. Запишите условия щелевого испытания; ширина лабораторной щели не подменяет неизвестное раскрытие скважинной трещины.</p>
        <div className="grid gap-2 sm:grid-cols-2 my-2">
          {(["slotUm", "slotDpMPa", "slotVolumeMl", "slotTimeMin"] as const).map((key, i) =>
            <NumberField key={key + d.facts[key]} label={["Ширина щели, мкм", "Перепад на щели, МПа", "Объём, прошедший щель, мл", "Время щелевого теста, мин"][i]}
              value={d.facts[key]} onChange={v => setFact(key, v)} />)}
          {(["slotResult", "compatibility"] as const).map(key => <label key={key}>{key === "slotResult" ? "Результат щелевого теста" : "Совместимость с жидкостями"}
            <select aria-label={key === "slotResult" ? "Результат щелевого теста" : "Совместимость с жидкостями"} className={inputClass} value={d[key]} onChange={v => set({ [key]: v.target.value as RirLabDraft[typeof key] })}>
              <option value="unknown">Не испытано</option><option value="pass">Соответствует методике</option><option value="fail">Не соответствует</option>
            </select></label>)}
        </div>
        <label>Методики, температурный график, замечания, загрязнение и фильтрация<textarea className={inputClass} value={d.notes} onChange={v => set({ notes: v.target.value })} /></label>
      </details>
      <div className="overflow-x-auto"><table className="w-full table-fixed break-words text-xs"><thead><tr><th>Испытание</th><th>Факт</th><th>Требование</th><th>Оценка</th></tr></thead>
        <tbody>{e.checks.map(x => <tr key={x.label} className="border-t"><td className="p-1">{x.label}</td><td>{x.actual}</td><td>{x.target}</td><td className={x.status === "fail" ? "text-destructive" : ""}>
          {x.status === "pass" ? "Соответствует" : x.status === "fail" ? "Не соответствует" : "Не оценено"}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!mass.valid || !e.identity || !e.conditions}
          onClick={() => set({ testedKey: recipeKey(d), appliedKey: undefined })}>Привязать результаты к этой пробе</Button>
        <Button disabled={!e.usable || kind === "resin_micro"} onClick={() => set({ appliedKey: recipeKey(d) })}>Применить измеренные свойства в расчёте РИР</Button>
        {d.appliedKey && <Button variant="outline" onClick={() => set({ appliedKey: undefined })}>Отключить перенос свойств</Button>}
        <Button variant="outline" onClick={async () => { try { await exportLabProtocolDocx(buildRirLabProtocol(d, context, totalM3), "Лаборатория_РИР.docx"); setError(""); } catch { setError("Не удалось сформировать Word."); } }}>Протокол лаборатории (Word)</Button>
      </div>
      <p>Для привязки нужны номер, лаборатория, исполнитель, дата и партии всех компонентов.
        Для переноса нужны измеренные плотность, ПВ / вязкость, время жизни и давление испытания.
        Переносятся только эти свойства; ПВ суспензии остаётся приближением вязкости течения в канале. Несоответствия остальных тестов сохраняются и не означают допуск к работам.</p>
      {error && <p role="alert">{error}</p>}
    </CardContent>
  </Card>;
}
