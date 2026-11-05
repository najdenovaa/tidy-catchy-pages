import { Input } from '@/components/ui/input';
import type { CentralizerSpec } from '@/lib/centralization-calculations';
import { kgfToKN, passportExamples, passportWarnings, type CentralizerPassport } from '@/lib/centralizer-passports';

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
    ['length', 'Длина / высота изделия, мм'], ['startingForceKgf', 'Пусковое усилие, не более, кгс'],
    ['holdingForceKN', 'Удерживающее усилие крепления, кН'], ['frictionCoefficient', 'Коэффициент трения материала'],
  ];
  if (spec.type === 'spring') fields.push(['restoringForceKgf', 'Восстанавливающее усилие, не менее, кгс'], ['restoringStandoff', 'Степень центрирования при испытании, %']);
  return <div className="space-y-3 border border-border rounded-md p-3">
    <label className="block text-xs">Заполнить по предоставленному паспорту
      <select aria-label="Пример паспорта" className="block w-full bg-background border border-input rounded p-2 mt-1" value="" onChange={e => {
        const example = passportExamples.find(x => x.id === e.target.value);
        if (example) onChange(structuredClone(example.spec));
      }}><option value="">Выберите изделие или внесите свой паспорт</option>{passportExamples.map(x => <option key={x.id} value={x.id}>{x.spec.passport!.model}</option>)}</select>
    </label>
    <label className="block text-xs">Обозначение изделия из паспорта<Input value={p?.model ?? ''} onChange={e => onChange({ ...spec, passport: { ...p, model: e.target.value } })} /></label>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <label className="text-xs">Количество рессор / лопастей, шт.<Input type="number" min={0} step={1} value={spec.bladesCount} onChange={e => onChange({ ...spec, bladesCount: Number(e.target.value) })} /></label>
      {fields.map(([key, label]) => <label key={key} className="text-xs">{label}<Input type="number" min={0} step="any" value={p?.[key] as number ?? ''} placeholder="Не указано" onChange={e => patch(key, e.target.value)} /></label>)}
    </div>
    {spec.type === 'spring' && <label className="block text-xs">То же восстанавливающее усилие, кН (если паспорт использует кН)<Input type="number" min={0} step="any" value={p?.restoringForceKgf === undefined ? '' : Number(kgfToKN(p.restoringForceKgf).toFixed(5))} placeholder="Не указано" onChange={e => patch('restoringForceKgf', e.target.value === '' ? '' : String(Number(e.target.value) / 0.00980665))} /></label>}
    {p?.source && <p className="text-xs text-muted-foreground">Источник: {p.source}. Числа вводятся без знаков ±, «не менее» и «не более»; допуски проверяются отдельно.</p>}
    {p?.note && <p className="text-xs text-amber-500">{p.note}</p>}
    {passportWarnings(spec, casingOD).map(w => <p role="alert" key={w} className="text-xs text-destructive">{w}</p>)}
    <p className="text-xs text-muted-foreground">Для рессор используйте усилие при указанной степени центрирования (обычно 67%). 1 кгс = 0,00980665 кН. Удержание муфт, пусковое усилие и прочность материала не являются восстанавливающим усилием.</p>
    {p ? <p className="text-xs">В расчёте: наружный диаметр ограничивает степень центрирования; усилие рессор {spec.restoringForce.toFixed(3)} кН задаёт приближённую жёсткость. Остальные паспортные данные служат для проверки выбора и монтажа; коэффициент материала не заменяет коэффициент трения всей колонны в T&amp;D. Для жёстких изделий без нагрузочной характеристики учитывается прогиб трубы между опорами без добавочной упругой жёсткости.</p> : <p className="text-xs text-amber-500">Паспорт не заполнен. Используются прежние модельные параметры, их нужно подтвердить паспортом или испытанием.</p>}
  </div>;
}
