import { normalizeEquipmentReference, normalizeLibraryCentralizer } from "./equipment-library-reference";
import { buildCentralizerJointSchedule } from "./cementing-report-data";
import type { CentralizerSpec, CentralizerInterval } from "./centralization-calculations";
import type { WellData } from './cementing-calculations';
export type EquipmentKind = 'shoe' | 'floatCollar' | 'checkValve' | 'lowerPlug' | 'upperPlug' | 'centralizer' | 'stopCollar' | 'stageCollar' | 'basket';
export const EQUIPMENT_LABELS: Record<EquipmentKind, string> = {
  shoe: 'Башмак', floatCollar: 'Поплавковая муфта / ЦКОД', checkValve: 'Обратный клапан', lowerPlug: 'Нижняя пробка', upperPlug: 'Верхняя пробка',
  centralizer: 'Центратор', stopCollar: 'Стопорное кольцо', stageCollar: 'Муфта ступенчатого цементирования', basket: 'Цементировочная корзина',
};
export interface EquipmentProduct {
  id: string; kind: EquipmentKind; model: string; manufacturer: string; sourceUrl: string; note: string;
  maxTemperatureC?: number; membraneRuptureMinMPa?: number; membraneRuptureMaxMPa?: number;
  backpressureMPa?: number;
}
const make = (id: string, kind: EquipmentKind, model: string, path: string, note: string, extra: Partial<EquipmentProduct> = {}): EquipmentProduct =>
  ({ id, kind, model, manufacturer: 'ООО «Аврора»', sourceUrl: `https://gk-avrora.ru/${path}`, note, ...extra });
export const EQUIPMENT_PRODUCTS: readonly EquipmentProduct[] = [
  make('avrora-102p', 'shoe', 'AVRORA 102П', 'catalog/', 'Направляющий башмак с пластиковым носом. Обратный клапан в этом обозначении не заявлен.'),
  make('avrora-112pb', 'shoe', 'AVRORA 112ПБ', 'catalog/', 'Поплавковый башмак с композитным носом. Размер, резьба и исполнение клапана - по паспорту поставки.'),
  make('avrora-114sg', 'shoe', 'AVRORA 114-SG', 'catalog/', 'Поплавковый башмак с вращающимся носом. Не подменяет отдельную поплавковую муфту в комплектации.'),
  make('avrora-105vk', 'shoe', 'AVRORA 105ВК', 'catalog/', 'Премиальный башмак. Исполнение и паспортные ограничения требуется уточнить.'),
  make('avrora-141sg', 'floatCollar', 'AVRORA 141-SG', 'poplavkovaja-mufta-avrora-141-sg/', 'Посадка пробки, фиксация от вращения, обратный клапан SG; один или два клапана по заказу. Противодавление зависит от типоразмера.', { maxTemperatureC: 130 }),
  make('avrora-141sg-u', 'floatCollar', 'AVRORA 141-SG-У', 'catalog/', 'Усиленная поплавковая муфта. Характеристики SG не переносятся на это исполнение автоматически.'),
  make('avrora-111sg', 'floatCollar', 'AVRORA 111-SG', 'catalog/', 'Поплавковая муфта. Типоразмер, посадочная система пробок и паспортное исполнение требуют подтверждения.'),
  make('avrora-sff', 'checkValve', 'SFF', 'catalog/', 'Клапанный узел, устанавливаемый в поплавковое оборудование; не дополнительная муфта. 24-часовая прокачка; перевод из автозаполнения расходом свыше 23 л/с.', { backpressureMPa: 35 }),
  make('avrora-sff-plus', 'checkValve', 'SFF PLUS', 'catalog/', 'Полимерный клапанный узел (кроме пружины), 48-часовая прокачка. Температурный предел зависит от исполнения.', { backpressureMPa: 70 }),
  make('avrora-141p-down', 'lowerPlug', 'AVRORA 141-П Plug Down', 'probka-avrora-141-p-plug-down/', 'Нижняя разделительная пробка с полимерным фиксатором. Разрыв мембраны по каталогу поплавкового оборудования: 1-1,5 МПа; уточнить паспорт конкретной поставки.', { membraneRuptureMinMPa: 1, membraneRuptureMaxMPa: 1.5 }),
  make('avrora-141p-up', 'upperPlug', 'AVRORA 141-П Plug Up', 'probka-avrora-141-%D0%BF-plug-up/', 'Верхняя продавочная пробка с фиксацией от вращения; при посадке формирует сигнал «Стоп». Допустимое посадочное давление не опубликовано.', { maxTemperatureC: 120 }),
  make('avrora-451', 'lowerPlug', 'AVRORA 451 PLUG DOWN 4', 'catalog/', 'Нижняя пробка с противовращением. Совместимость и давление мембраны - по паспорту.'),
  make('avrora-450', 'upperPlug', 'AVRORA 450 PLUG UP4', 'catalog/', 'Верхняя пробка с противовращением. Допустимое посадочное давление - по паспорту.'),
  make('avrora-416', 'lowerPlug', 'AVRORA 416', 'catalog/', 'Нижняя четырёхлепестковая пробка.'),
  make('avrora-415', 'upperPlug', 'AVRORA 415', 'catalog/', 'Верхняя четырёхлепестковая пробка.'),
  make('avrora-200', 'centralizer', 'AVRORA 200', 'centrator-avrora-200/', 'Полужёсткий цельный. Размеры, число и размещение - из расчёта центрирования и паспорта.'),
  make('avrora-205', 'centralizer', 'AVRORA 205', 'centrator-avrora-205/', 'Пружинный цельный. Размеры, число и размещение - из расчёта центрирования и паспорта.'),
  make('avrora-210', 'centralizer', 'AVRORA 210', 'centrator-avrora-210/', 'Полупринудительный сварной. Силовую характеристику необходимо задать по испытанию.'),
  make('avrora-500s', 'basket', 'AVRORA 500S', 'korzina-cementirovochnaja-avrora-500s/', 'Цементировочная корзина для формирования седиментационной перемычки; не центратор и не герметичный пакер.'),
  make('avrora-520', 'stageCollar', 'AVRORA 520', 'catalog/', 'Муфта ступенчатого цементирования. Схема ступеней, объёмы и давления открытия/закрытия задаются отдельно.'),
  make('avrora-530', 'stageCollar', 'AVRORA 530', 'catalog/', 'Муфта ступенчатого цементирования. Исполнение и рабочие пределы - по паспорту.'),
];
export interface EquipmentSelection {
  libraryReference?: import("./equipment-library-reference").EquipmentLibraryReference;
  centralizerSpec?: CentralizerSpec;
  id: string; productId?: string; kind: EquipmentKind; model: string; manufacturer: string; sourceUrl?: string;
  quantity: number; casingOD?: number; outerDiameter?: number; passageID?: number; thread?: string;
  depthMD?: number; maxTemperatureC?: number; backpressureMPa?: number; membraneRuptureMPa?: number;
  basketSupportPct?: number; basketBridgeMin?: number; basketCarrierDensityGcm3?: number; basketCapacityKN?: number;
  stopPressureMPa?: number; passport?: string; note?: string;
}
export const equipmentProduct = (id?: string) => EQUIPMENT_PRODUCTS.find(p => p.id === id);
export function selectEquipment(p: EquipmentProduct, id: string): EquipmentSelection {
  return { id, productId: p.id, kind: p.kind, model: p.model, manufacturer: p.manufacturer, sourceUrl: p.sourceUrl, quantity: 1,
    maxTemperatureC: p.maxTemperatureC, backpressureMPa: p.backpressureMPa, note: p.note };
}
export function equipmentWarnings(e: EquipmentSelection, w: WellData): string[] {
  const a: string[] = [];
  if (!Number.isInteger(e.quantity) || e.quantity <= 0) a.push('Укажите положительное целое количество.');
  if (!e.casingOD) a.push('Типоразмер под ОК не подтверждён паспортом.');
  else if (Math.abs(e.casingOD - w.casingOD) > 1) a.push(`Типоразмер ${e.casingOD} мм не соответствует ОК ${w.casingOD} мм.`);
  if (e.outerDiameter && e.outerDiameter > Math.min(w.holeDiameter, w.prevCasingID > 0 ? w.prevCasingID : Infinity) && e.kind !== 'centralizer' && e.kind !== 'basket') a.push('Наружный диаметр превышает проход ствола или предыдущей колонны.');
  if (e.depthMD !== undefined && (e.depthMD < 0 || e.depthMD > w.casingDepthMD)) a.push('Глубина установки вне обсадной колонны.');
  if (e.maxTemperatureC && Math.max(w.bottomTempStatic, w.bottomTempCirc) > e.maxTemperatureC) a.push(`Температура превышает предел ${e.maxTemperatureC} °C. Проверьте температуру на глубине установки.`);
  if ((e.kind === 'lowerPlug' || e.kind === 'upperPlug') && !e.passageID) a.push('Проверьте диапазон рабочих ID пробки и посадочную совместимость с муфтой по паспорту.');
  if (e.kind === 'basket' && e.basketSupportPct !== undefined && e.basketSupportPct > 100) a.push('Доля передачи нагрузки должна быть от 0 до 100%; в сценарии ограничена 100%.');
  if (e.kind === 'basket' && e.basketCarrierDensityGcm3 !== undefined && e.basketCarrierDensityGcm3 <= 0) a.push('Плотность несущей жидкости должна быть положительной; до исправления используется сценарное значение 1 г/см³.');
  if (!e.passport) a.push('Паспорт поставки и резьбовая совместимость не подтверждены.');
  return a;
}
/** Restore only finite optional values; blanks stay unknown, never become nominal zero limits. */
export function normalizeEquipment(value: unknown): EquipmentSelection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    .filter(x => typeof x.kind === 'string' && Object.prototype.hasOwnProperty.call(EQUIPMENT_LABELS, x.kind)).map((x, i) => {
      const out: EquipmentSelection = { id: typeof x.id === 'string' ? x.id : `equipment-${i}`, kind: x.kind as EquipmentKind,
        model: typeof x.model === 'string' ? x.model : '', manufacturer: typeof x.manufacturer === 'string' ? x.manufacturer : '', quantity: typeof x.quantity === 'number' && Number.isFinite(x.quantity) ? x.quantity : 1 };
      for (const k of ['productId', 'sourceUrl', 'thread', 'passport', 'note'] as const) if (typeof x[k] === 'string') out[k] = x[k];
      for (const k of ['casingOD', 'outerDiameter', 'passageID', 'depthMD', 'maxTemperatureC', 'backpressureMPa', 'membraneRuptureMPa', 'stopPressureMPa', 'basketSupportPct', 'basketBridgeMin', 'basketCarrierDensityGcm3', 'basketCapacityKN'] as const)
        if (typeof x[k] === 'number' && Number.isFinite(x[k]) && x[k] >= 0) out[k] = x[k];
      const ref=normalizeEquipmentReference(x.libraryReference);if(ref)out.libraryReference=ref;
      const spec=normalizeLibraryCentralizer(x.centralizerSpec);if(spec&&out.kind==='centralizer')out.centralizerSpec=spec;
      return out;
    });
}
export function equipmentDetails(e: EquipmentSelection): string {
  return [e.casingOD ? `ОК ${e.casingOD} мм` : 'типоразмер не задан', e.depthMD !== undefined ? `MD ${e.depthMD} м` : '',
    e.outerDiameter ? `OD ${e.outerDiameter} мм` : '', e.passageID ? `ID/проход ${e.passageID} мм` : '', e.thread ? `резьба ${e.thread}` : '',
    e.maxTemperatureC ? `Tmax ${e.maxTemperatureC} °C` : '', e.backpressureMPa ? `обратный перепад ${e.backpressureMPa} МПа` : '',
    e.membraneRuptureMPa ? `разрыв мембраны ${e.membraneRuptureMPa} МПа` : '', e.stopPressureMPa ? `допустимая посадка ${e.stopPressureMPa} МПа` : '', e.kind === 'basket' ? `сценарий передачи ${e.basketSupportPct ?? 0}%; перемычка ${e.basketBridgeMin ?? 'не задано'} мин; несущая жидкость ${e.basketCarrierDensityGcm3 ?? 1} г/см³; несущая способность ${e.basketCapacityKN ?? 'не задана'} кН` : '', e.passport ? `паспорт ${e.passport}` : 'паспорт не задан'].filter(Boolean).join('; ');
}

/** Count the actual placement points, including partial joints and every-Nth-joint placement. */
export function centralizerInventory(depth: number, intervals: CentralizerInterval[]) {
  const rows = buildCentralizerJointSchedule(depth, intervals);
  const groups = new Map<string, { model: string; manufacturer: string; quantity: number; sourceUrl?: string }>();
  for (const row of rows) for (const placement of row.placements) {
    const spec=placement.spec;
    const p = spec.passport, model = p?.model || spec.type, manufacturer = p?.manufacturer || 'не указан';
    const key = model + '|' + manufacturer + '|' + (spec.libraryReference?.entryId??'') + '|' + (spec.libraryReference?.revision??''), g = groups.get(key) ?? { model, manufacturer, quantity: 0, sourceUrl: p?.sourceUrl };
    g.quantity++; groups.set(key, g);
  }
  return [...groups.values()];
}
