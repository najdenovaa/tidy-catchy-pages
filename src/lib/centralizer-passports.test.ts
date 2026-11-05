import { describe, expect, it } from 'vitest';
import { kgfToKN, passportExamples, passportWarnings } from './centralizer-passports';
import { calculateCentralization, autoPlaceCentralizers } from './centralization-calculations';
import type { WellData } from './cementing-calculations';
const well: WellData = {
  wellDepthMD: 100, wellDepthTVD: 100, casingDepthMD: 100, casingOD: 178, casingWall: 8,
  pumpZoneTop: 0, pumpZoneBottom: 0, holeDiameter: 220.7, cavernCoeff: 1, prevCasingDepth: 0, prevCasingID: 0, prevCasingOD: 0,
  ckodDepth: 100, cementRiseHeight: 0, bottomTempStatic: 50, bottomTempCirc: 30,
  trajectory: [{md: 0, tvd: 0, zenith: 0, azimuth: 0}, {md: 100, tvd: 100, zenith: 0, azimuth: 0}],
};
describe('Паспортные данные оснастки', () => {
  it('переводит кгс в кН без смешения с усилием муфт', () => {
    expect(kgfToKN(1200)).toBeCloseTo(11.76798, 5);
    const s = passportExamples[2].spec;
    expect(s.restoringForce).toBeCloseTo(4.97197, 5);
    expect(s.passport?.holdingForceKN).toBe(55);
    expect(s.maxAxialLoad).toBe(0);
  });
  it('берёт диаметр ЦТГП из таблицы, угол из технических характеристик', () => {
    const p = passportExamples[3].spec.passport!;
    expect(p.outerDiameter).toBe(210);
    expect(p.innerDiameter).toBe(182);
    expect(p.bladeAngle).toBe(55);
    expect(p.restoringForceKgf).toBeUndefined();
  });
  it('не подставляет радиальное усилие и угол, отсутствующие в паспорте 560', () => {
    const s = passportExamples[1].spec;
    expect(s.restoringForce).toBe(0);
    expect(s.passport?.bladeAngle).toBeUndefined();
    expect(passportWarnings(s, 245).length).toBeGreaterThan(0);
  });
  it('ограничивает standoff реальным наружным диаметром', () => {
    const spec = passportExamples[1].spec;
    const result = calculateCentralization(well, [{id:'1', fromMD:0, toMD:100, jointLength:12, centralizersPerJoint:1, spec}], 1100);
    expect(result.length).toBeGreaterThan(0);
    expect(Math.max(...result.map(r => r.standoff))).toBeLessThanOrEqual(79.7);
    const placement = autoPlaceCentralizers(well, spec, 12, 95, 1100);
    expect(placement.every(p => p.standoffAchieved < 95)).toBe(true);
  });
});
