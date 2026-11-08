import { describe, it, expect } from 'vitest';
import { CEMENT_PRODUCTS, cementProduct, identityOf, productWarnings } from './cement-product-catalog';
import { applyDesignToSlurry, designSlurry, designToTargets, type DesignConditions } from './cement-recipe-designer';
import { normalizeSlurryInput, normalizeBufferFluid, normalizeWellData } from './cementing-normalizers';
import { buildRecipe } from './cement-program';
import { getCementingExample } from './cementing-example';
import { createRirLab, recipeKey, buildRirLabProtocol, evaluateRirLab } from './rir-laboratory';
import { designRirComposition } from './rir-compositions';
const conditions: DesignConditions = { densityGcm3: 1.85, bhctC: 60, bhstC: 80, tTopC: 40, tBottomC: 80, maxPressureMPa: 30, requiredThickeningMin: 180, coversPay: true, gas: false, maxZenithDeg: 20, lossMarginMPa: 5, isTail: true };
describe('commercial cement products', () => {
  it('keeps uncertain units and bulk density out of automatic absolute-volume inputs', () => {
    expect(CEMENT_PRODUCTS.every(p => p.manufacturer && p.sourceUrl && p.technicalSpec)).toBe(true);
    expect(cementProduct('ig-clean-l')!.bwocRange).toBeUndefined();
    expect(cementProduct('ig-rheology')!.bwocRange).toBeUndefined();
    expect(cementProduct('ig-mku85')!.bwocRange).toBeUndefined();
    expect(cementProduct('ig-flice')!.maxTemperatureC).toBeUndefined();
  });
  it('retains doses, exposes range and temperature violations, and labels the product SG as assumed', () => {
    const r = designToTargets({ ...conditions, bhstC: 130 }, { doses: { retarder: 1, dispersant: .5 }, products: { retarder: { id: 'ig-retard', batch: 'R26' }, dispersant: { id: 'ig-flex' } } });
    const x = r.design.components.find(c => c.role === 'retarder')!;
    expect(x).toMatchObject({ name: 'IG Retard', manufacturer: 'IG chemical / Айсберг', pctBwoc: 1, sg: 1.3, sgAssumed: true, batch: 'R26' });
    expect(r.design.warnings.join(' ')).toMatch(/вне опубликованного диапазона/);
    expect(r.design.warnings.join(' ')).toMatch(/выше опубликованного предела/);
    expect(r.compliance.every(c => c.ok === null)).toBe(true);
  });
  it('uses a supplied true SG in volume balance, without silently using bulk density', () => {
    const opts = { doses: { dispersant: .3 }, products: { dispersant: { id: 'ig-flex', sg: 1.8 } } };
    const d = designSlurry(conditions, opts);
    expect(d.components.find(c => c.role === 'dispersant')).toMatchObject({ name: 'IG Flex', sg: 1.8, sgAssumed: false });
    expect(d.densityGcm3).toBeCloseTo(1.85, 3);
    const s = normalizeSlurryInput(applyDesignToSlurry(getCementingExample().slurries[0], d));
    expect(s.additives.find(a => a.productId === 'ig-flex')).toMatchObject({ manufacturer: 'IG chemical / Айсберг', specificGravity: 1.8 });
    const recipe = buildRecipe(s, 3);
    expect(recipe.perM3.additives.find(a => a.productId === 'ig-flex')?.name).toContain('IG chemical / Айсберг');
    expect(recipe.perM3.additives.find(a => a.productId === 'ig-flex')?.sgSource).toBe('user');
  });
  it('preserves product identity and explicit kilogram doses for a buffer across session normalization', () => {
    const b = normalizeBufferFluid({ ...getCementingExample().buffers[0], additives: [{ ...identityOf(cementProduct('ig-clean-l')!), name: 'IG Clean (L)', massKg: 10, percentage: 0, batch: 'C26' }] });
    expect(b.additives[0]).toMatchObject({ productId: 'ig-clean-l', massKg: 10, percentage: 0, manufacturer: 'IG chemical / Айсберг', batch: 'C26' });
  });
  it('invalidates RIR laboratory bindings after manufacturer or lot changes, and exports material identity', () => {
    const context = { bhctC: 48, bhstC: 60, requiredMin: 180 };
    const d = createRirLab('cement', designRirComposition('cement', { ...context, requiredWorkLifeMin: 180, volumeM3: 3, targetDensity: 1.85 }, 2)!.primary, context);
    d.ingredients[1] = { ...d.ingredients[1], ...identityOf(cementProduct('ig-flex')!), name: 'IG Flex', batch: 'F26' };
    const k = recipeKey(d); d.testedKey = k; d.appliedKey = k;
    d.ingredients[1].manufacturer = 'Другой изготовитель';
    expect(recipeKey(d)).not.toBe(k);
    expect(evaluateRirLab(d, context).applied).toBe(false);
    const protocol = JSON.stringify(buildRirLabProtocol(d, context, 3));
    expect(protocol).toContain('Другой изготовитель'); expect(protocol).toContain('F26');
  });
});
