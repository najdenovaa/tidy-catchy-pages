/** Commercial product identity is separate from an engineering correlation and lot measurements. */
export interface ProductIdentity {
  productId?: string;
  manufacturer?: string;
  technicalSpec?: string;
  sourceUrl?: string;
  batch?: string;
}
export interface CementProduct {
  id: string; name: string; manufacturer: string; technicalSpec: string; sourceUrl: string;
  role: string; purpose: string; use: 'cement' | 'buffer';
  dosage: string; bwocRange?: readonly [number, number]; maxTemperatureC?: number;
  note: string;
}
const sourceUrl = 'https://igchem.ru/chemical';
const manufacturer = 'IG chemical / Айсберг';
const product = (id: string, name: string, tu: string, p: Omit<CementProduct, 'id' | 'name' | 'technicalSpec' | 'manufacturer' | 'sourceUrl'>): CementProduct =>
  ({ id, name, manufacturer, sourceUrl, technicalSpec: `ТУ 20.59.59-${tu}-30392090-2024`, ...p });
export const CEMENT_PRODUCTS: readonly CementProduct[] = [
  product('ig-retard', 'IG Retard', '001', { role: 'retarder', purpose: 'Замедлитель', use: 'cement', dosage: '0,1-0,7% от массы сухого цемента (BWOC)', bwocRange: [0.1, 0.7], maxTemperatureC: 100, note: 'Предел температуры относится к статическим условиям. Истинная плотность не опубликована.' }),
  product('ig-flice', 'IG FLice', '002', { role: 'fluidLoss', purpose: 'Понизитель водоотдачи', use: 'cement', dosage: '0,2-1% BWOC', bwocRange: [0.2, 1], note: 'Температурный диапазон на сайте указан неоднозначно (15-18 °C); требуется паспорт. Истинная плотность не опубликована.' }),
  product('ig-flex', 'IG Flex', '003', { role: 'dispersant', purpose: 'Поликарбоксилатный диспергатор', use: 'cement', dosage: '0,05-0,3% BWOC', bwocRange: [0.05, 0.3], maxTemperatureC: 160, note: 'Корреляция типового пластификатора не калибрована для этого продукта. Истинная плотность не опубликована.' }),
  product('ig-antifoam-l', 'IG AntiFoam (L)', '007', { role: 'defoamer', purpose: 'Жидкий пеногаситель', use: 'cement', dosage: 'От 0,05%; база процента в источнике не уточнена', note: 'Базу дозирования и плотность жидкости уточнить по паспорту партии. Не применять автоматически в пеноцементе: требуется испытание совместимости с пенообразователем.' }),
  product('ig-clean-l', 'IG Clean (L)', '004', { role: 'wash', purpose: 'Химическая промывка', use: 'buffer', dosage: 'От 5 кг/м³ промывочного раствора', note: 'На сайте одновременно указаны порошок и жидкая поставка; форму и истинную плотность уточнить по паспорту.' }),
  product('ig-rheology', 'IG Rheology', '005', { role: 'spacer', purpose: 'Реологический буфер', use: 'buffer', dosage: '1-10% от объёма воды по формулировке изготовителя', note: 'Базу и единицы дозирования уточнить. В BWOC автоматически не переводится. Реология определяется испытанием фактической буферной системы.' }),
  product('ig-mku85', 'МКУ-85', '010', { role: 'microsilica', purpose: 'Микрокремнезём уплотнённый', use: 'cement', dosage: '2-20% от объёма смеси по формулировке изготовителя', note: 'Не микросферы и не кварцевая мука. Базу дозирования и истинную плотность уточнить. Заявления о прочности бетона не являются прогнозом прочности тампонажного камня.' }),
];
export const cementProduct = (id: string | undefined) => CEMENT_PRODUCTS.find(p => p.id === id);
export const identityOf = (p: CementProduct): ProductIdentity => ({ productId: p.id, manufacturer: p.manufacturer, technicalSpec: p.technicalSpec, sourceUrl: p.sourceUrl });
export function materialLabel(p: ProductIdentity & { name: string }): string {
  return [p.name, p.manufacturer, p.technicalSpec, p.batch ? `партия ${p.batch}` : ''].filter(Boolean).join(' / ');
}
export function productWarnings(p: CementProduct, doseBwoc?: number, temperatureC?: number): string[] {
  const out: string[] = [];
  if (p.bwocRange && doseBwoc !== undefined && (doseBwoc < p.bwocRange[0] || doseBwoc > p.bwocRange[1])) out.push(`${p.name}: ${doseBwoc.toFixed(2)}% BWOC вне опубликованного диапазона ${p.dosage}.`);
  if (!p.bwocRange) out.push(`${p.name}: ${p.dosage}. Введённая массовая дозировка требует подтверждения технологом.`);
  if (p.maxTemperatureC !== undefined && temperatureC !== undefined && temperatureC > p.maxTemperatureC) out.push(`${p.name}: температура ${temperatureC.toFixed(0)} °C выше опубликованного предела ${p.maxTemperatureC} °C.`);
  return [...out, p.note];
}
/** Only compatible functional roles can be substituted in an existing design. */
export type ProductChoices = Partial<Record<'retarder' | 'fluidLoss' | 'dispersant' | 'defoamer', { id: string; sg?: number; batch?: string }>>;
export function normalizeProductIdentity(source: Record<string, unknown>): ProductIdentity {
  const out: ProductIdentity = {};
  for (const k of ['productId', 'manufacturer', 'technicalSpec', 'sourceUrl', 'batch'] as const)
    if (typeof source[k] === 'string' && source[k]) out[k] = source[k];
  return out;
}
