import type { CentralizerSpec } from './centralization-calculations';

export interface CentralizerPassport {
  model: string;
  source?: string;
  casingOD?: number;
  boreDiameter?: number;
  outerDiameter?: number;
  innerDiameter?: number;
  length?: number;
  restoringForceKgf?: number;
  restoringStandoff?: number;
  startingForceKgf?: number;
  holdingForceKN?: number;
  frictionCoefficient?: number;
  bladeAngle?: number;
  note?: string;
}
export const kgfToKN = (value: number) => value * 0.00980665;
export const passportExamples: { id: string; spec: CentralizerSpec }[] = [
  { id: 'winner555', spec: { type: 'spring', bladesCount: 6, bladeHeight: 25.26, restoringForce: kgfToKN(1200), maxAxialLoad: 0, passport: {
    model: 'WINNER 555/245/295', source: 'Паспорт тип 555, ред. 00, стр. 4', casingOD: 244.48, boreDiameter: 295.3, outerDiameter: 295, innerDiameter: 249, length: 360, restoringForceKgf: 1200, restoringStandoff: 67, startingForceKgf: 10, holdingForceKN: 55,
    note: 'Номинальные размеры без допусков. Восстанавливающее усилие не менее 1200 кгс; пусковое не более 10 кгс. Две муфты тип 600; затяжка 30 Н·м.' } } },
  { id: 'highslick560', spec: { type: 'rigid', bladesCount: 6, bladeHeight: 17.1, restoringForce: 0, maxAxialLoad: 0, passport: {
    model: 'HIGH SLICK 560/178/212', source: 'Паспорт тип 560, ред. 00, стр. 4', casingOD: 177.8, boreDiameter: 220.7, outerDiameter: 212, innerDiameter: 180, length: 245, holdingForceKN: 55, frictionCoefficient: 0.1,
    note: 'Ствол не менее 220,7 мм. Угол лопастей и радиальная нагрузочная характеристика не указаны. Момент затяжки: таблица 35 Н·м, инструкция 30 Н·м - уточнить у изготовителя. Имя файла отличается от обозначения и размеров в паспорте.' } } },
  { id: 'spring178', spec: { type: 'spring', bladesCount: 6, bladeHeight: 19, restoringForce: kgfToKN(507), maxAxialLoad: 0, passport: {
    model: 'SPRING-178/215,9-3/320', source: 'Паспорт SPRING, таблица 1, лист 3', casingOD: 178, boreDiameter: 215.9, outerDiameter: 216, innerDiameter: 181, length: 320, restoringForceKgf: 507, restoringStandoff: 67, startingForceKgf: 50, holdingForceKN: 55,
    note: 'Минимальное восстанавливающее усилие 507 кгс (5 кН); максимальное 1014 кгс (9,9 кН). Для консервативной оценки взято минимальное. Усилие до необратимой деформации 296 кН - отдельный параметр, не усилие восстановления. Затяжка 38-40 Н·м.' } } },
  { id: 'ctgp178', spec: { type: 'rigid', bladesCount: 4, bladeHeight: 16, restoringForce: 0, maxAxialLoad: 0, passport: {
    model: 'ЦТГП-178/216', source: 'Руководство ЦТГП, пп. 1.2.2-1.2.7 и таблица 1', casingOD: 178, outerDiameter: 210, innerDiameter: 182, length: 254, frictionCoefficient: 0.2, holdingForceKN: 11.2, bladeAngle: 55,
    note: 'Обозначение 178/216 взято с обложки; размеры - из строки ЦТГП-178/216: наружный диаметр не более 210 мм, внутренний 182 мм. Прочность полимера 90 МПа на сжатие и 60 МПа на изгиб не заменяет восстанавливающее усилие. 11,2 кН - удержание крепления. Радиальная нагрузочная характеристика не указана.' } } },
];

export function passportWarnings(spec: CentralizerSpec, casingOD: number): string[] {
  const p = spec.passport;
  if (!p) return [];
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(p)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) warnings.push(`Недопустимое числовое значение: ${key}.`);
  }
  if (!p.outerDiameter) warnings.push('Внесите наружный диаметр изделия из паспорта.');
  if (spec.type === 'spring' && (!p.restoringStandoff || p.restoringStandoff >= 100)) warnings.push('Внесите степень центрирования при испытании усилия: больше 0 и меньше 100%.');
  if (p.casingOD && Math.abs(p.casingOD - casingOD) > 1) warnings.push(`Паспорт для колонны ${p.casingOD} мм, в скважине ${casingOD} мм. Проверьте совместимость.`);
  if (p.innerDiameter && p.innerDiameter <= casingOD) warnings.push('Внутренний диаметр изделия должен быть больше наружного диаметра трубы.');
  if (p.outerDiameter && p.outerDiameter <= casingOD) warnings.push('Наружный диаметр изделия должен быть больше наружного диаметра трубы.');
  if (spec.type === 'spring' && !p.restoringForceKgf) warnings.push('Для рессорного центратора требуется восстанавливающее усилие из паспорта или испытаний.');
  return warnings;
}
