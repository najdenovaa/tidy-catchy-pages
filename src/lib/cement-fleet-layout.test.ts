// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cementFleetLayout, cementFleetLayoutFigure } from './cement-fleet-layout';
import { DEFAULT_LOGISTICS, planLogistics } from './cement-logistics';
import { fleetTemplate, type FleetScheme } from './cement-fleet-catalog';
import { getCementingExample } from './cementing-example';
import type { PressureProfileResult, MaterialSummary } from './cementing-calculations';
const ex = getCementingExample();
const pressure = { points: [{ time: 1, pumpRateLps: 10, surfacePressure: 10, stage: 'Цемент' }] } as PressureProfileResult;
const materials = { cementItems: [{ name: 'Цемент', amount: 40, unit: 'т' }], waterTotal: 20 } as MaterialSummary;
describe('Actual fleet top view', () => {
  for (const scheme of ['classic', 'single', 'twin', 'mixer-ca'] as FleetScheme[]) {
    it(`${scheme}: draws each actual vehicle and connects SKC to the discharge line`, () => {
      const settings = { ...fleetTemplate(scheme, DEFAULT_LOGISTICS), waterSource: 'tankers' as const,
        equipmentQuantities: { main: 2, bulk: 2, 'support-ca': 1, 'reserve-ca': 2, skc: 2, mixer: 3, water: 2, averaging: 1, manifold: 1 } };
      const r = planLogistics(pressure, materials, ex.slurries, settings), svg = cementFleetLayout(r, settings);
      for (const row of r.equipment) expect((svg.match(new RegExp(`data-equipment-id="${row.id}"`, 'g')) ?? []).length).toBe(row.count);
      expect((svg.match(/data-vehicle="true"/g) ?? []).length).toBe(r.totalVehicles);
      expect(svg).toContain('data-pressure-line="aggregate-to-well"');
      expect(svg).toContain('Датчики СКЦ в нагнетательной линии');
      expect(svg).not.toContain('связь СКЦ');
      expect(svg).not.toMatch(/NaN|Infinity/);
      const figure = cementFleetLayoutFigure(r, settings);
      expect(svg).toContain(`viewBox="0 0 ${figure.width} ${figure.height}"`);
      if (process.env.REPORT_QA_DIR) {
        mkdirSync(process.env.REPORT_QA_DIR, { recursive: true });
        writeFileSync(join(process.env.REPORT_QA_DIR, `actual-fleet-${scheme}.svg`), svg);
      }
    });
  }
  it('does not draw absent vehicles and expands for larger actual fleets', () => {
    const settings = { ...fleetTemplate('single', DEFAULT_LOGISTICS), equipmentQuantities: { main: 7, bulk: 11, 'support-ca': 0, 'reserve-ca': 1, skc: 1 } };
    const r = planLogistics(pressure, materials, ex.slurries, settings), f = cementFleetLayoutFigure(r, settings);
    expect(f.svg.match(/data-equipment-id="bulk"/g)).toHaveLength(11);
    expect(f.svg.match(/data-equipment-id="main"/g)).toHaveLength(7);
    expect(f.svg).not.toContain('data-equipment-id="support-ca"');
    expect(f.svg).not.toContain('data-equipment-id="mixer"');
    expect(f.height).toBeGreaterThan(900);
  });
});
