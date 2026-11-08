import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EQUIPMENT_PRODUCTS, EQUIPMENT_LABELS, equipmentProduct, selectEquipment, equipmentWarnings, type EquipmentKind, type EquipmentSelection } from '@/lib/cementing-equipment';
import type { CentralizerInterval } from '@/lib/centralization-calculations';
import { centralizerInventory } from '@/lib/cementing-equipment';
import type { WellData } from '@/lib/cementing-calculations';
const cls = 'w-full min-w-0 rounded border border-border bg-background p-2 text-xs';
export default function CementingEquipmentCard({ well, centralizers = [], onChange }: { well: WellData; centralizers?: CentralizerInterval[]; onChange: (w: WellData) => void }) {
  const [kind, setKind] = useState<EquipmentKind>('shoe');
  const items = well.equipment ?? [];
  const write = (next: EquipmentSelection[]) => onChange({ ...well, equipment: next });
  const add = (productId?: string) => {
    const p = equipmentProduct(productId), id = globalThis.crypto?.randomUUID?.() ?? `equipment-${Date.now()}-${items.length}`;
    write([...items, p ? selectEquipment(p, id) : { id, kind, model: '', manufacturer: '', quantity: 1 }]);
  };
  return <Card data-testid="cementing-equipment"><CardHeader><CardTitle className="text-base">Комплектация обсадной колонны</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-xs text-muted-foreground">Каталог ООО «Аврора» и ручной ввод по паспорту. Укажите типоразмер, резьбу, количество и глубину. Данные входят в сохранение расчёта и Word-отчёт. Центраторы и их размещение рассчитываются во вкладке «Центрирование».</p>
    <div className="flex flex-wrap gap-2"><select className={cls + ' sm:w-60'} aria-label="Категория оснастки" value={kind} onChange={e => setKind(e.target.value as EquipmentKind)}>{Object.entries(EQUIPMENT_LABELS).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <select className={cls + ' sm:w-72'} aria-label="Изделие Аврора" value="" onChange={e => { if (e.target.value) add(e.target.value); }}><option value="">Добавить из каталога</option>{EQUIPMENT_PRODUCTS.filter(p => p.kind === kind).map(p => <option key={p.id} value={p.id}>{p.model}</option>)}</select>
      <Button variant="outline" size="sm" onClick={() => add()}>Внести свой паспорт</Button></div>
    {centralizers.length > 0 && <div className="rounded border p-2 text-xs"><p className="font-semibold">Центраторы по последней рассчитанной расстановке</p>{centralizerInventory(well.casingDepthMD, centralizers).map(c => <p key={c.model + c.manufacturer}>{c.model} · {c.manufacturer} · {c.quantity} шт.</p>)}<p className="text-muted-foreground">После изменения условий пересчитайте центрирование. Эта ведомость не добавляется повторно к ручной комплектации.</p></div>}
    {!items.length && <p className="text-xs">Комплектация пока не задана.</p>}
    {items.map((e, i) => { const patch = (p: Partial<EquipmentSelection>) => write(items.map((x, j) => j === i ? { ...x, ...p } : x)); const product = equipmentProduct(e.productId);
      return <div key={e.id} className="rounded-lg border p-3 space-y-2"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{EQUIPMENT_LABELS[e.kind]}</h4><Button variant="ghost" size="sm" onClick={() => write(items.filter((_, j) => j !== i))}>Удалить</Button></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([['model', 'Модель'], ['manufacturer', 'Производитель'], ['passport', 'Паспорт / исполнение'], ['thread', 'Соединительная резьба']] as const).map(([k, l]) => <label className="text-xs" key={k}>{l}<input className={cls} value={e[k] ?? ''} onChange={v => patch({ [k]: v.target.value })} /></label>)}
          {([['quantity', 'Количество, шт.'], ['casingOD', 'Типоразмер ОК, мм'], ['depthMD', 'Глубина установки MD, м'], ['outerDiameter', 'Наружный диаметр, мм'], ['passageID', 'Проход / рабочий ID пробки, мм'], ['maxTemperatureC', 'Макс. температура, °C'], ['backpressureMPa', 'Допустимый обратный перепад, МПа'], ['membraneRuptureMPa', 'Разрыв мембраны нижней пробки, МПа'], ['stopPressureMPa', 'Допустимый перепад при посадке, МПа']] as const).filter(([k]) => k !== 'backpressureMPa' || ['shoe', 'floatCollar', 'checkValve'].includes(e.kind)).filter(([k]) => k !== 'membraneRuptureMPa' || e.kind === 'lowerPlug').filter(([k]) => k !== 'stopPressureMPa' || ['upperPlug', 'floatCollar'].includes(e.kind)).map(([k, l]) => <label className="text-xs" key={k}>{l}<input type="number" min="0" step={k === 'quantity' ? 1 : 'any'} className={cls} placeholder="Не задано" value={e[k] ?? ''} onChange={v => patch({ [k]: v.target.value === '' ? (k === 'quantity' ? 0 : undefined) : Number(v.target.value) })} /></label>)}
        </div>
        {e.depthMD !== undefined && e.depthMD > 0 && (e.kind === 'shoe' ? e.depthMD <= well.wellDepthMD : e.kind === 'floatCollar' && e.depthMD <= well.casingDepthMD) && <Button variant="outline" size="sm" onClick={() => onChange({ ...well, [e.kind === 'shoe' ? 'casingDepthMD' : 'ckodDepth']: e.depthMD })}>{e.kind === 'shoe' ? 'Принять глубину башмака для расчёта' : 'Принять глубину ЦКОД для расчёта'}</Button>}
        {e.kind === 'basket' && <div className="rounded border p-3 space-y-2"><p className="text-xs font-semibold">Сценарий после «Стоп»: передача нагрузки на корзину</p><p className="text-xs text-muted-foreground">Параметры задаются для оценки чувствительности. Корзина не герметизирует затрубье. Без доли передачи и времени формирования перемычки снижение давления не начисляется.</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{([['basketSupportPct','Доля передачи нагрузки, %'],['basketBridgeMin','Формирование перемычки после Стоп, мин'],['basketCarrierDensityGcm3','Плотность несущей жидкости, г/см³'],['basketCapacityKN','Несущая способность с креплением, кН']] as const).map(([k,l])=><label className="text-xs" key={k}>{l}<input aria-label={l} type="number" min={k==='basketCarrierDensityGcm3'?0.1:0} max={k==='basketSupportPct'?100:undefined} step="any" placeholder={k==='basketCarrierDensityGcm3'?'1.0':'Не задано'} className={cls} value={e[k]??''} onChange={v=>patch({[k]:v.target.value===''?undefined:Number(v.target.value)})}/></label>)}</div></div>}
        {product && <p className="text-xs text-muted-foreground">{product.note}</p>}
        <label className="block text-xs">Примечание<textarea className={cls} value={e.note ?? ''} onChange={v => patch({ note: v.target.value })} /></label>
        {e.sourceUrl && <a className="text-xs text-primary underline" href={e.sourceUrl} target="_blank" rel="noreferrer">Источник изготовителя</a>}
        {equipmentWarnings(e, well).map(n => <p className="text-xs text-amber-700 dark:text-amber-400" key={n}>{n}</p>)}
      </div>;
    })}
    {items.some(e=>e.kind==='basket')&&<label className="block text-xs">Момент оценки после «Стоп», мин<input aria-label="Момент оценки корзины после Стоп" type="number" min="0" step="1" className={cls} value={well.basketEvaluationMin??5} onChange={e=>onChange({...well,basketEvaluationMin:Math.max(0,Number(e.target.value))})}/><span className="text-muted-foreground">Для изменения графика и отчёта нажмите «Расчёт». При 0 мин разгрузка отсутствует.</span></label>}
    <p className="text-xs text-muted-foreground">Обратный перепад клапана, разрыв мембраны нижней пробки и давление посадки верхней пробки - разные параметры. Каталожные пределы не заменяют гидравлическое сопротивление. Давление «Стоп» и глубина ЦКОД остаются отдельными расчётными вводами.</p>
  </CardContent></Card>;
}
