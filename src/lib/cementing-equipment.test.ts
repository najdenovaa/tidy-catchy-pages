import { it, expect } from 'vitest';
import { EQUIPMENT_PRODUCTS, equipmentProduct, equipmentWarnings, normalizeEquipment, selectEquipment } from './cementing-equipment';
import { normalizeWellData } from './cementing-normalizers';
import { getCementingExample } from './cementing-example';
const well = getCementingExample().wellData;
it('separates baskets, non-return pressure, plug rupture, and plug bump ratings', () => {
  expect(equipmentProduct('avrora-500s')?.kind).toBe('basket');
  const valve = selectEquipment(equipmentProduct('avrora-sff-plus')!, 'v');
  expect(valve.backpressureMPa).toBe(70);
  expect(valve.stopPressureMPa).toBeUndefined();
  expect(valve.membraneRuptureMPa).toBeUndefined();
  const plug = selectEquipment(equipmentProduct('avrora-141p-down')!, 'p');
  expect(plug.membraneRuptureMPa).toBeUndefined(); // range 1-1.5 must be confirmed, not collapsed to a nominal
  expect(EQUIPMENT_PRODUCTS.every(p => p.manufacturer === 'ООО «Аврора»' && p.sourceUrl.startsWith('https://gk-avrora.ru/'))).toBe(true);
});
it('preserves a BOM on session load, keeping unknown dimensions unknown and rejecting malformed data', () => {
  const e = { ...selectEquipment(equipmentProduct('avrora-141sg')!, 'f'), quantity: 1, depthMD: well.ckodDepth, casingOD: well.casingOD, passport: 'ПС-168-26', thread: 'ОТТМ', stopPressureMPa: 8 };
  const w = normalizeWellData(JSON.parse(JSON.stringify({ ...well, equipment: [e] })));
  expect(w.equipment).toEqual([e]);
  expect(w.ckodShearPressureMPa).toBe(well.ckodShearPressureMPa); // a BOM rating never silently overwrites the hydraulic stop setting
  expect(w.equipment![0].outerDiameter).toBeUndefined();
  expect(normalizeEquipment([{ kind: 'bad', quantity: 1 }])).toEqual([]);
  expect(normalizeEquipment([{ kind: 'shoe', outerDiameter: Infinity, maxTemperatureC: -10 }])[0].outerDiameter).toBeUndefined();
});
it('detects mismatched casing, restricted passage, excessive temperature and invalid installation depth', () => {
  const e = { ...selectEquipment(equipmentProduct('avrora-141sg')!, 'f'), casingOD: well.casingOD + 20, outerDiameter: well.holeDiameter + 10, depthMD: well.casingDepthMD + 1, maxTemperatureC: 10 };
  const text = equipmentWarnings(e, well).join(' ');
  expect(text).toContain('не соответствует'); expect(text).toContain('превышает проход'); expect(text).toContain('вне обсадной'); expect(text).toContain('Температура превышает');
});
it('counts centralizers from actual joint placement including a final short joint', async () => {
  const { centralizerInventory } = await import('./cementing-equipment');
  const rows = centralizerInventory(25, [{ id: 'c', fromMD: 0, toMD: 25, jointLength: 12, centralizersPerJoint: 1,
    spec: { type: 'spring', bladesCount: 6, bladeHeight: 25, restoringForce: 2, maxAxialLoad: 0,
      passport: { model: 'AVRORA 205', manufacturer: 'ООО «Аврора»' } } }]);
  expect(rows).toEqual([{ model: 'AVRORA 205', manufacturer: 'ООО «Аврора»', quantity: 3, sourceUrl: undefined }]);
});
