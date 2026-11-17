import {useMemo} from 'react';
import {rheologyHierarchy,rheologyHierarchyFigures} from '@/lib/rheology-hierarchy';
import type {RheologyReportInput} from '@/lib/rheology-fluids';
export default function RheologyHierarchy({input}:{input:RheologyReportInput}){
 const h=useMemo(()=>rheologyHierarchy(input),[input]),plots=useMemo(()=>rheologyHierarchyFigures(input),[input]);
 return <section className="space-y-3" aria-label="Реологическая иерархия жидкостей"><h3 className="text-base font-semibold">Реологическая иерархия жидкостей</h3><p className="text-xs text-muted-foreground">{h.sequenceSource} {h.rangeSource}</p>
 <p className="text-xs text-muted-foreground">Основная реология БР сравнивается с последующими жидкостями. Забойный набор БР не считается отдельной закачанной жидкостью. Модельные кривые не являются лабораторными измерениями.</p>
 {h.issues.map((x,i)=><p key={i} role="status" className="text-xs text-amber-700">{x}</p>)}
 <div className="overflow-auto"><table className="text-xs w-full"><thead><tr><th>№ / жидкость</th><th>Модель / источник</th><th>Условия испытаний</th></tr></thead><tbody>{h.fluids.map(f=><tr key={f.order}><td className="p-2">{f.label}</td><td>{f.data.applied.label}; {f.appliedSource}</td><td>{f.temperatureC===null?'T не указана':`T ${f.temperatureC} °C`}; {f.pressureMPaAbs===null?'P не указано':`P ${f.pressureMPaAbs} МПа абс.`}; {f.source}</td></tr>)}</tbody></table></div>
 {!plots.length&&<p role="status" className="text-sm">Совмещённые графики недоступны. Проверьте последовательность, модели и общий диапазон.</p>}
 <div className="grid xl:grid-cols-2 gap-3">{plots.map(p=><div className="overflow-auto border rounded bg-white" role="img" aria-label={p.title} key={p.plotId}><div className="min-w-[650px] [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{__html:p.svg}}/></div>)}</div>
 <div className="overflow-auto"><table className="text-xs w-full"><thead><tr><th>Соседняя пара</th><th>Δτ на сетке</th><th>Условия сравнения</th><th>Мин. / макс., Па</th></tr></thead><tbody>{h.pairs.map((p,i)=><tr key={i}><td className="p-2">{p.beforeName} - {p.afterName}</td><td>{p.ordering}</td><td>{p.conditions}</td><td>{p.minDelta?.toFixed(3)??'Нет'} / {p.maxDelta?.toFixed(3)??'Нет'}</td></tr>)}</tbody></table></div>
 <p className="text-xs text-muted-foreground">{h.note} Условия задаются рядом с показаниями Fann каждой жидкости; изменения попадут в анализ после пересчёта.</p></section>;
}
