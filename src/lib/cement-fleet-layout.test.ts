// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cementFleetLayout, cementFleetLayoutFigure, cementFleetConnections } from './cement-fleet-layout';
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

it('classic: keeps dry SMN, water/jet pumps, averaging and high-pressure pumps in distinct stages',()=>{
 const settings={...DEFAULT_LOGISTICS,equipmentQuantities:{mixer:5,main:3,'blend-ca':1,averaging:1,manifold:1}};
 const r=planLogistics(pressure,materials,ex.slurries,settings);
 expect(r.mixingCA).toBe(1);expect(r.mainUnits).toBe(3);
 expect(r.unitsWorking).toBe(4);expect(r.dischargeUnits).toBe(3);
 const edges=cementFleetConnections(r).map(e=>`${e.from}/${e.to}/${e.kind}`);
 expect(edges).toContain('mixer/funnel/dry');expect(edges).toContain('water-source/blend-ca/water');
 expect(edges).toContain('blend-ca/funnel/jet-water');expect(edges).toContain('funnel/averaging/mixed-slurry');
 expect(edges).toContain('averaging/main/suction');expect(edges).toContain('main/manifold/discharge');expect(edges).toContain('manifold/well/common-discharge');
 expect(edges).not.toContain('water-source/mixer/water');expect(edges).not.toContain('mixer/main/suction');
 for(const id of ['averaging','manifold'])expect(r.equipment.find(e=>e.id===id)?.vehicle).toBe(true);
 const noTank=planLogistics(pressure,materials,ex.slurries,{...settings,equipmentQuantities:{...settings.equipmentQuantities,averaging:0}});
 expect(noTank.feasible).toBe(false);
});
it('integrated machines use the onboard manifold alone; multiple discharge machines need an external collector',()=>{
 for(const scheme of ['single','twin'] as FleetScheme[]){
  const s={...fleetTemplate(scheme,DEFAULT_LOGISTICS),equipmentQuantities:{main:1,'support-ca':0}};
  const one=planLogistics(pressure,materials,ex.slurries,s);
  expect(one.equipment.find(e=>e.id==='manifold')?.count).toBe(0);
  expect(cementFleetConnections(one)).toContainEqual(expect.objectContaining({from:'main',to:'well',kind:'discharge'}));
  const two=planLogistics(pressure,materials,ex.slurries,{...s,equipmentQuantities:{main:2,'support-ca':0}});
  expect(two.equipment.find(e=>e.id==='manifold')?.count).toBe(1);
  expect(cementFleetConnections(two)).toContainEqual(expect.objectContaining({from:'main',to:'manifold'}));
 }
});
it('standalone mixer receives water and bulk cement, and supplies CA suction before the manifold',()=>{
 const s={...fleetTemplate('mixer-ca',DEFAULT_LOGISTICS),equipmentQuantities:{main:3,mixer:1,bulk:2}};
 const r=planLogistics(pressure,materials,ex.slurries,s),edges=cementFleetConnections(r);
 for(const[from,to]of[['water-source','mixer'],['bulk','mixer'],['mixer','main'],['main','manifold'],['manifold','well']])expect(edges).toContainEqual(expect.objectContaining({from,to}));
 expect(r.mixingCA).toBe(0);
});
