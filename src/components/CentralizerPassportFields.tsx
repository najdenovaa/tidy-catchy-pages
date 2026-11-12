import EquipmentLibrary from "./EquipmentLibrary";
import { equipmentReferenceText, centralizerSignature } from "@/lib/equipment-library-reference";
import { Input } from '@/components/ui/input';
import type { CentralizerSpec } from '@/lib/centralization-calculations';
import { kgfToKN, passportExamples, passportWarnings, passportAssumptions, type CentralizerPassport } from '@/lib/centralizer-passports';

export default function CentralizerPassportFields({ spec, casingOD, onChange }: {
  spec: CentralizerSpec; casingOD: number; onChange: (spec: CentralizerSpec) => void;
}) {
  const p = spec.passport;
  const patch = (key: keyof CentralizerPassport, value: string) => {
    const passport = { model: '', ...p, [key]: value === '' ? undefined : Number(value) };
    onChange({ ...spec, passport,
      bladeHeight: passport.outerDiameter ? Math.max(0, (passport.outerDiameter - casingOD) / 2) : spec.bladeHeight,
      restoringForce: passport.restoringForceKgf === undefined ? 0 : kgfToKN(passport.restoringForceKgf),
    });
  };
  const fields: [keyof CentralizerPassport, string][] = [
    ['casingOD', 'Диаметр обсадной колонны, мм'], ['boreDiameter', 'Диаметр ствола по паспорту, мм'],
    ['outerDiameter', 'Наружный диаметр по рессорам / лопастям, мм'], ['innerDiameter', 'Внутренний диаметр изделия, мм'],
    ['massKg', 'Масса по паспорту, кг'], ['length', 'Длина / высота изделия, мм'], ['springLength', 'Длина рессоры, мм'], ['bladeWidth', 'Ширина рессоры / лопасти, мм'], ['ringOD', 'Наружный диаметр по кольцам, мм'], ['ringLength', 'Длина кольца, мм'], ['materialThickness', 'Толщина рессоры, мм'], ['startingForceKgf', 'Пусковое усилие, не более, кгс'], ['runningForceKgf', 'Сопротивление движению по испытанию, кгс'],
    ['holdingForceKN', 'Удерживающее усилие крепления, кН'], ['frictionCoefficient', 'Коэффициент трения материала'],
  ];
  if (spec.type === 'spring') fields.push(['restoringForceKgf', p?.forceLimitAmbiguous ? 'Восстанавливающее усилие по таблице, кгс' : 'Восстанавливающее усилие, не менее, кгс'], ['restoringStandoff', 'Степень центрирования при испытании, %']);
  return <div className="space-y-3 border border-border rounded-md p-3">
    <EquipmentLibrary spec={spec} onSpecChange={onChange} />
    {spec.libraryReference&&<p className="text-xs">{equipmentReferenceText(spec.libraryReference,centralizerSignature(spec))}</p>}
    <label className="block text-xs">Выбрать из справочника оснастки
      <select aria-label="Пример паспорта" className="block w-full bg-background border border-input rounded p-2 mt-1" value="" onChange={e => {
        const example = passportExamples.find(x => x.id === e.target.value);
        if (example) onChange(structuredClone(example.spec));
      }}><option value="">Выберите изделие или внесите свой паспорт</option>{[true, false].flatMap(compatible => ['ПЦ-1', 'ПЦ-2', 'Остальная оснастка'].map(series => {
        const items = passportExamples.filter(x => ((Math.abs((x.spec.passport?.casingOD ?? 0)-casingOD)<=1)===compatible) && (x.spec.passport?.series ?? 'Остальная оснастка')===series);
        return items.length ? <optgroup key={`${compatible}-${series}`} label={`${compatible ? `Для текущей колонны ${casingOD} мм` : 'Другие диаметры'} · ${series}`}>{items.map(x => <option key={x.id} value={x.id}>{x.spec.passport!.model}{(x.spec.passport!.outerDiameter ?? 0)<=(x.spec.passport!.innerDiameter ?? 0)?' · требует уточнения':''}</option>)}</optgroup> : null;
      }))}</select>
    </label>
    <label className="block text-xs">Производитель<Input value={p?.manufacturer ?? ''} onChange={e => onChange({ ...spec, passport: { model: '', ...p, manufacturer: e.target.value } })} /></label>
    {p?.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Каталог изготовителя</a>}
    <label className="block text-xs">Обозначение изделия из паспорта<Input value={p?.model ?? ''} onChange={e => onChange({ ...spec, passport: { ...p, model: e.target.value } })} /></label>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <label className="text-xs">Количество рессор / лопастей, шт.<Input type="number" min={0} step={1} value={spec.bladesCount} onChange={e => onChange({ ...spec, bladesCount: Number(e.target.value) })} /></label>
      {fields.map(([key, label]) => <label key={key} className="text-xs">{label}<Input type="number" min={0} step="any" value={typeof p?.[key] === 'number' ? Number((p[key] as number).toFixed(3)) : ''} placeholder="Не указано" onChange={e => patch(key, e.target.value)} /></label>)}
    </div>
    {spec.type === 'spring' && <label className="block text-xs">То же восстанавливающее усилие, кН (если паспорт использует кН)<Input type="number" min={0} step="any" value={p?.restoringForceKgf === undefined ? '' : Number(kgfToKN(p.restoringForceKgf).toFixed(5))} placeholder="Не указано" onChange={e => patch('restoringForceKgf', e.target.value === '' ? '' : String(Number(e.target.value) / 0.00980665))} /></label>}
    {(p?.lengthRange || p?.bladeWidthRange) && <p role="status" className="text-xs text-amber-500">Диапазоны из каталога: {p.lengthRange ? `длина ${p.lengthRange} мм; ` : ''}{p.bladeWidthRange ? `ширина рессоры ${p.bladeWidthRange} мм. ` : ''}Точный размер исполнения введите по паспорту поставки; диапазон не заменяется средним числом.</p>}
    {p?.boreDiameterRange && <p className="text-xs">Диаметр ствола по обозначению: {p.boreDiameterRange} мм. Введите конкретный диаметр по паспорту исполнения.</p>}
    {p?.restoringForceSourceKN !== undefined && <p className="text-xs">В исходной таблице: восстановление {p.restoringForceSourceKN} кН; пусковое усилие не более {p.startingForceSourceKN} кН. Исходные числа сохраняются независимо от правки расчётных полей.</p>}
    {p?.source && <p className="text-xs text-muted-foreground">Источник: {p.source}. Числа вводятся без знаков ±, «не менее» и «не более»; допуски проверяются отдельно.</p>}
    {p?.note && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Примечания и условия источника</summary><p className="mt-2">{p.note}</p></details>}
    {passportAssumptions(spec).length > 0 && <div role="status" className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1"><b>Оценочный расчёт доступен</b>{passportAssumptions(spec).map(note => <p key={note}>{note}</p>)}</div>}
    {spec.type === 'spring' && !p?.restoringForceKgf && p && <label className="block text-xs">Модельное восстанавливающее усилие, кН (допущение)<Input type="number" min={0.01} step={0.1} value={p.estimatedRestoringForceKN ?? 5} onChange={e => patch('estimatedRestoringForceKN', e.target.value)} /></label>}
    {passportWarnings(spec, casingOD).map(w => <p role="alert" key={w} className="text-xs text-destructive">{w}</p>)}
    <p className="text-xs text-muted-foreground">Для рессор используйте усилие при указанной степени центрирования (обычно 67%). 1 кгс = 0,00980665 кН. Удержание муфт, пусковое усилие и прочность материала не являются восстанавливающим усилием.</p>
    {p ? <p className="text-xs">В расчёте: наружный диаметр ограничивает степень центрирования; {p.restoringForceKgf && p.restoringStandoff ? <>усилие рессор {spec.restoringForce.toFixed(3)} кН задаёт приближённую жёсткость.</> : <>недостающие параметры заменяются явно указанными допущениями оценочной модели.</>} Остальные паспортные данные служат для проверки выбора и монтажа; коэффициент материала не заменяет коэффициент трения всей колонны в T&amp;D. Для жёстких изделий без нагрузочной характеристики учитывается прогиб трубы между опорами без добавочной упругой жёсткости.</p> : <p className="text-xs text-amber-500">Паспорт не заполнен. Используются прежние модельные параметры, их нужно подтвердить паспортом или испытанием.</p>}
  </div>;
}
