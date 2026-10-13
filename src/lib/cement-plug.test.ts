import { describe, it, expect } from "vitest";
import { calculateBalancedPlug, type PlugInputs } from "./cement-plug-calculations";

const A = (mm: number) => (Math.PI / 4) * (mm / 1000) ** 2;
const base = (o: Partial<PlugInputs> = {}): PlugInputs => ({
  well: {
    wellDepthMD: 3000, holeDiameter: 215.9, casingShoe: 2000, casingID: 150.4, pipeOD: 89, pipeID: 75.9, cavernCoeff: 1.2,
    trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 3000, tvd: 3000, zenith: 0, azimuth: 0 }],
  },
  plug: { topMD: 2600, bottomMD: 2650 },
  cement: { name: "Цемент", density: 1.85, rheology: { pv: 50, yp: 10 } },
  spacer: { name: "Буфер", density: 1.1, rheology: { pv: 5, yp: 2 } },
  wellFluid: { name: "Раствор", density: 1.2, rheology: { pv: 15, yp: 5 } },
  spacerVolumeAboveM3: 0.3, spacerVolumeBelowM3: 0, safetyMarginM: 30, thickeningTimeMin: 180, pullOutAbovePlugM: 50,
  washType: "direct", washCycles: 2, tripSpeedMs: 0.3,
  pumpRateCementLs: 5, pumpRateSpacerLs: 5, pumpRateDisplacementLs: 8, pumpRateWashLs: 10,
  ...o,
});

describe("Цементный мост: установка на равновесии", () => {
  const bore = 215.9 * Math.sqrt(1.2);

  it("объём моста: сечение × длина, цемент делится между затрубьем и трубами без потерь", () => {
    const r = calculateBalancedPlug(base());
    expect(r.cementVolumeTotal).toBeCloseTo(A(bore) * 50, 3);
    expect(r.cementVolumeAnn + r.cementVolumePipe).toBeCloseTo(r.cementVolumeTotal, 2);
  });

  it("без недопродавки — точное равновесие, но предупреждение о мокром подъёме", () => {
    const r = calculateBalancedPlug(base({ underDisplacementM3: 0 }));
    expect(Math.abs(r.imbalanceMPa)).toBeLessThan(0.005);
    expect(r.isBalanced).toBe(true);
    expect(r.balanceNotes.some((n) => n.startsWith("Точное равновесие"))).toBe(true);
    // продавка = объём труб от устья до кровли буфера в трубах
    const spacerTopPipe = r.fluidColumns.find((c) => c.location === "pipe" && c.label.includes("труб. верх"))!.topMD;
    expect(r.displacementVolume).toBeCloseTo(A(75.9) * spacerTopPipe, 2);
  });

  it("недопродавка: продавка меньше, трубы тяжелее ровно на (Δhтр + Δhзатр)·(ρц − ρр)·g", () => {
    const r0 = calculateBalancedPlug(base({ underDisplacementM3: 0 }));
    const r = calculateBalancedPlug(base({ underDisplacementM3: 0.3 }));
    expect(r0.displacementVolume - r.displacementVolume).toBeCloseTo(0.3, 3);
    const dh = 0.3 / A(75.9) + 0.3 / (A(bore) - A(89));
    const expected = dh * (1.85 - 1.2) * 9.81 / 1000;
    expect(r.imbalanceMPa).toBeCloseTo(expected, 2);
    expect(r.pressurePipe).toBeGreaterThan(r.pressureAnnulus); // раньше давления всегда совпадали
    expect(r.cementHeightPipeMD).toBeGreaterThan(r.cementHeightAnnMD);
    expect(r.cementVolumeAnn + r.cementVolumePipe).toBeCloseTo(r.cementVolumeTotal, 2);
    // уровень в трубах после остановки: ΔP / (ρр·g·(1 + Sтр/Sзатр на устье))
    const sP = A(75.9), sA = A(150.4) - A(89);
    expect(r.uTubeLevelDropM).toBeCloseTo((r.imbalanceMPa * 1e6) / (1200 * 9.81 * (1 + sP / sA)), 0);
    expect(r.isBalanced).toBe(true);
  });

  it("слишком большая недопродавка — предупреждение о загрязнении кровли", () => {
    const r = calculateBalancedPlug(base({ underDisplacementM3: 1.2 }));
    expect(r.balanceNotes.some((n) => n.startsWith("Недопродавка больше обычной"))).toBe(true);
  });

  it("запас на загрязнение поднимает кровлю по объёму", () => {
    const r = calculateBalancedPlug(base({ contaminationExcessPct: 10 }));
    expect(r.cementVolumeTotal).toBeCloseTo(r.cementVolumeDesign * 1.1, 2);
    expect(r.plugTopByVolumeMD).toBeCloseTo(2650 - 55, 0);
  });

  it("наклонный ствол: статика по TVD", () => {
    const traj = [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 1000, tvd: 1000, zenith: 0, azimuth: 0 }, { md: 3000, tvd: 2600, zenith: 40, azimuth: 0 }];
    const r = calculateBalancedPlug(base({ well: { ...base().well, trajectory: traj }, underDisplacementM3: 0 }));
    expect(r.plugLengthTVD).toBeLessThan(50);
    expect(Math.abs(r.imbalanceMPa)).toBeLessThan(0.005);
  });
});

describe("Цементный мост: промывка", () => {
  it("затрубье выше башмака считается по ВД обсадной колонны, а не по стволу", () => {
    const r = calculateBalancedPlug(base({ washCycles: 1 }));
    const ann = (A(150.4) - A(89)) * 2000 + (A(215.9 * Math.sqrt(1.2)) - A(89)) * (2550 - 2000);
    expect(r.washVolumeM3).toBeCloseTo(ann, 1);
  });
});

import { assessPlugExchange, yieldNumberCriticalExp, gelAt, Y_C_THEORY } from "./cement-plug-exchange";

describe("Цементный мост: устойчивость против обмена жидкостями", () => {
  const cem = { name: "Цемент", density: 1.85, gel10s: 10, gel10min: 30, yp: 10 };
  const mud = { name: "Раствор", density: 1.2, gel10s: 3, gel10min: 6, yp: 5 };
  const ex = (o: Partial<Parameters<typeof assessPlugExchange>[0]> = {}) =>
    assessPlugExchange({ support: "fluid", boreDiameterMm: 215.9, zenithDeg: 0, plugLengthM: 50, cement: cem, below: mud, ...o });

  it("Y = СНС/(Δρ·g·R) и пределы по наклону", () => {
    const r = ex();
    expect(r.interfaces[0].Y0).toBeCloseTo(10 / (650 * 9.81 * 0.10795), 4);
    expect(yieldNumberCriticalExp(0)).toBe(0.2);
    expect(yieldNumberCriticalExp(45)).toBeCloseTo(0.3, 6);
    expect(r.interfaces[0].tauRequiredTheoryPa).toBeCloseTo(Y_C_THEORY * 650 * 9.81 * 0.10795, 1);
  });

  it("промысловая оценка (по умолчанию): обычный мост на растворе устоит с небольшой осадкой", () => {
    const r = ex();
    expect(r.verdict).toBe("settle");
    expect(r.interfaces[0].Y0).toBeLessThan(r.interfaces[0].YcExp); // лабораторный критерий не выполнен
    expect(r.interfaces[0].exchangeLengthM).toBeLessThan(5);
  });

  it("лабораторная скорость (k = 1): тот же мост с риском или неустойчив, закрытый низ не спасает", () => {
    const r = ex({ velocityFactor: 1 });
    expect(["risk", "unstable"]).toContain(r.verdict);
    expect(r.interfaces[0].bottomSmearM).toBeGreaterThan(5);
    expect(r.recommendations.length).toBeGreaterThan(2);
  });

  it("пачка с достаточным СНС делает мост устойчивым; пачка тяжелее цемента — обмена нет", () => {
    const need = ex().interfaces[0].tauRequiredTheoryPa;
    const pad = { name: "Пачка", density: 1.15, gel10s: need * 1.1, gel10min: need * 1.3, yp: 30 };
    const r = ex({ below: pad, belowPad: mud, padLengthM: 40 });
    expect(r.interfaces[0].verdict).toBe("guaranteed");
    const heavy = ex({ below: { ...pad, density: 1.9, gel10s: 5, gel10min: 10 }, belowPad: mud });
    expect(heavy.interfaces[0].verdict).toBe("no-buoyancy");
    // но тяжёлая пачка над лёгким раствором — новая неустойчивая граница
    expect(heavy.interfaces[1].deltaRhoKgM3).toBeGreaterThan(0);
  });

  it("узкий ствол (колонна 114 мм) устойчивее широкого при той же реологии", () => {
    expect(ex({ boreDiameterMm: 100 }).interfaces[0].Y0).toBeGreaterThan(ex({ boreDiameterMm: 250 }).interfaces[0].Y0);
  });

  it("опора на забой / механическая — обмена нет", () => {
    expect(ex({ support: "bottom" }).verdict).toBe("supported");
    expect(ex({ support: "mechanical" }).verdict).toBe("supported");
  });

  it("структура цемента растёт со временем, раствор выходит на плато", () => {
    expect(gelAt({ ...cem, isCement: true }, 30)).toBeGreaterThan(gelAt({ ...cem, isCement: true }, 10));
    expect(gelAt(mud, 30)).toBeCloseTo(gelAt(mud, 10), 6);
  });

  it("расчёт моста: подошва у забоя → опора, иначе — анализ обмена", () => {
    expect(calculateBalancedPlug(base()).exchange.support).toBe("fluid");
    expect(calculateBalancedPlug(base({ plug: { topMD: 2950, bottomMD: 3000 } })).exchange.verdict).toBe("supported");
  });
});

import { simulatePlugPressures } from "./cement-plug-pressure-sim";

describe("Цементный мост: давления при закачке", () => {
  const inp = base({ underDisplacementM3: 0 });
  const res = calculateBalancedPlug(inp);
  const pts = simulatePlugPressures(inp, res, 0.018);
  it("статика: забойное = гидростатика раствора по TVD", () => {
    expect(pts[0].bhpMPa).toBeCloseTo(1.2 * 9.81 * 2650 / 1000, 2);
    expect(pts[0].surfaceMPa).toBeCloseTo(0, 3);
  });
  it("после продавки цемент и буфер стоят на равновесии: давление на устье ≈ 0 без циркуляции", () => {
    const lastPump = [...pts].reverse().find((p) => p.stage === "Продавка")!;
    expect(Math.abs(lastPump.hydroStaticAnnMPa - lastPump.hydroStaticPipeMPa)).toBeLessThan(0.05);
    expect(lastPump.hydroStaticAnnMPa).toBeCloseTo(res.pressureAnnulus, 1);
  });
  it("трение в затрубье выше башмака считается по колонне, а не по стволу (меньше зазор → больше потери)", () => {
    const wide = simulatePlugPressures({ ...inp, well: { ...inp.well, casingID: 230 } }, calculateBalancedPlug({ ...inp, well: { ...inp.well, casingID: 230 } }), 0.018);
    const f1 = pts.find((p) => p.stage === "Цемент")!.frictionMPa, f2 = wide.find((p) => p.stage === "Цемент")!.frictionMPa;
    expect(f1).toBeGreaterThan(f2);
  });
  it("Гершель–Балкли по Fann меняет трение", () => {
    const fann = { r600: 60, r300: 38, r200: 30, r100: 20, r6: 8, r3: 7 };
    const i2 = { ...inp, wellFluid: { ...inp.wellFluid, rheology: { ...inp.wellFluid.rheology, fann } } };
    const p2 = simulatePlugPressures(i2, calculateBalancedPlug(i2), 0.018);
    expect(p2.find((p) => p.stage === "Цемент")!.frictionMPa).not.toBeCloseTo(pts.find((p) => p.stage === "Цемент")!.frictionMPa, 3);
  });
});

import { plugTemperatures } from "./cement-plug-calculations";
import { designPlugSlurry, plugRequiredThickeningMin, plugJobTimeMin, buildPlugLabProtocol } from "./cement-plug-recipe";

describe("Цементный мост: температура и рецептура", () => {
  const inp = base({ well: { ...base().well, bottomTempStatic: 95, surfaceTemp: 5 } });
  const r = calculateBalancedPlug(inp);
  it("статика по градиенту, BHCT ниже статики на подошве", () => {
    const t = plugTemperatures(inp.well, inp.plug);
    expect(t.tBottomStaticC).toBeCloseTo(5 + 90 * 2650 / 3000, 1);
    expect(t.bhctC).toBeLessThan(t.tBottomStaticC);
    expect(t.estimated).toBe(false);
    expect(plugTemperatures(base().well, base().plug).estimated).toBe(true);
  });
  it("требуемое загустевание: работа раствора ≤ 75% и не менее +30 мин", () => {
    const job = plugJobTimeMin(r);
    expect(plugRequiredThickeningMin(r)).toBeGreaterThanOrEqual(job / 0.75);
    expect(plugRequiredThickeningMin(r)).toBeGreaterThanOrEqual(job + 30);
  });
  it("рецептура: плотность замыкается, загустевание и прочность по назначению", () => {
    const ab = designPlugSlurry(inp, r, "abandonment", 24);
    expect(ab.design.densityGcm3).toBeCloseTo(1.85, 2);
    expect(ab.design.predicted.thickening30BcMin).toBeGreaterThanOrEqual(plugRequiredThickeningMin(r));
    const ko = designPlugSlurry(inp, r, "kickoff", 24);
    expect(ko.targets.strength24MinMPa).toBe(14);
    const lc = designPlugSlurry(inp, r, "lost_circulation", 24);
    expect(lc.design.components.some((c) => c.role === "fiber")).toBe(true);
  });
  it("протокол моста собирается и содержит требования", () => {
    const res = designPlugSlurry(inp, r, "kickoff", 24);
    const p = buildPlugLabProtocol(inp, r, res, "kickoff", 24);
    const rows = p.sections.find((s) => s.id === "props-0")!.tables![0].rows;
    expect(rows.find((x) => x[0].startsWith("Прочность 24"))![1]).toBe("≥ 14,00");
    expect(p.sections.find((s) => s.id === "recipe-0")!.tables![0].rows.length).toBeGreaterThan(3);
  });
});

import { autoDesignPlug } from "./cement-plug-autodesign";

describe("Цементный мост: автоподбор", () => {
  it("мост на растворе в открытом стволе: выбирается опора, вариант допустим по всем проверкам", () => {
    const inp = base({ well: { ...base().well, bottomTempStatic: 90, surfaceTemp: 5 } });
    const a = autoDesignPlug({ ...inp, exchangeVelocityFactor: 1 }, "abandonment", 24, 0.018);
    expect(a.best).not.toBeNull();
    // без опоры на минимальной длине мост не проходит; если выбран «без опоры» — только более длинный мост
    if (a.best!.support === "none") expect(a.best!.lengthM).toBeGreaterThan(50);
    expect(a.best!.lengthM).toBeGreaterThanOrEqual(50);
    const r = calculateBalancedPlug(a.best!.inputs);
    expect(["supported", "no-buoyancy", "guaranteed", "stable", "settle"]).toContain(r.exchange.verdict);
    expect(a.best!.maxBhpMPa!).toBeLessThan(a.best!.fracMPa);
  });
  it("мост в узкой колонне: хватает пачки, механическая опора не нужна", () => {
    const inp = base({ well: { ...base().well, casingShoe: 3000, casingID: 100.5, pipeOD: 60.3, pipeID: 50.3, holeDiameter: 100.5, cavernCoeff: 1, bottomTempStatic: 80 } });
    const a = autoDesignPlug(inp, "zonal_isolation", 24, 0.02);
    expect(a.best).not.toBeNull();
    expect(a.best!.support).not.toBe("mechanical");
  });
  it("подошва у забоя — опора на забой", () => {
    const inp = base({ plug: { topMD: 2940, bottomMD: 3000 }, well: { ...base().well, bottomTempStatic: 90 } });
    expect(autoDesignPlug(inp, "abandonment", 24, 0.018).best?.support).toBe("bottom");
  });
});

describe("Цементный мост: калибровка по отбивкам", () => {
  it("осадка пропорциональна множителю скорости — калибровка по факту линейна", () => {
    const mk = (k: number) => calculateBalancedPlug({ ...base(), exchangeVelocityFactor: k }).exchange.interfaces[0].exchangeLengthM;
    expect(mk(0.2)).toBeCloseTo(2 * mk(0.1), 6);
  });
});

import { designPill, requiredPillGelPa } from "./cement-plug-pill";

describe("Цементный мост: рецептура нижней пачки", () => {
  it("нужный СНС: Y_c·Δρ·g·R·1,2; пачка не легче цемента — не нужен", () => {
    expect(requiredPillGelPa({ cementDensity: 1.85, boreDiameterMm: 200, zenithDeg: 0, pillDensity: 1.2 })).toBe(Math.ceil(0.2 * 650 * 9.81 * 0.1 * 1.2));
    expect(requiredPillGelPa({ cementDensity: 1.85, boreDiameterMm: 200, zenithDeg: 0, pillDensity: 1.9 })).toBe(0);
  });
  it("тип пачки по нужному СНС и температуре", () => {
    expect(designPill(20, 1.2, 60, 2).type).toBe("bentonitePolymer");
    expect(designPill(45, 1.2, 60, 2).type).toBe("mmh");
    expect(designPill(150, 1.2, 70, 2).type).toBe("crosslinkedPAA");
    expect(designPill(150, 1.2, 110, 2).type).toBe("silicate");
    expect(designPill(400, 1.2, 60, 2).type).toBe("none");
  });
  it("бентонит-полимерная: СНС обеспечен, плотность доведена баритом по балансу масс и объёмов", () => {
    const d = designPill(25, 1.35, 60, 2);
    expect(d.meets).toBe(true);
    expect(d.predicted.gel10s).toBeGreaterThanOrEqual(25);
    const mass = d.waterLPerM3 + d.components.reduce((t, c) => t + c.kgPerM3, 0);
    const vol = d.waterLPerM3 / 1000 + d.components.reduce((t, c) => t + c.kgPerM3 / c.sg / 1000, 0);
    expect(mass / vol / 1000).toBeCloseTo(1.35, 2);
    expect(d.components.some((c) => c.name.startsWith("Барит"))).toBe(true);
  });
  it("протокол моста включает рецептуру пачки", () => {
    const inp = base({ well: { ...base().well, bottomTempStatic: 90 } });
    const r = calculateBalancedPlug(inp);
    const res = designPlugSlurry(inp, r, "abandonment", 24);
    const p = buildPlugLabProtocol(inp, r, res, "abandonment", 24, designPill(25, 1.2, 60, 2));
    expect(p.sections.some((s) => s.id === "pill")).toBe(true);
  });
});

describe("Цементный мост: зависимость осадки от интервала", () => {
  const mk = (top: number, bot: number, tt = 120) => calculateBalancedPlug(base({ plug: { topMD: top, bottomMD: bot }, thickeningTimeMin: tt, well: { ...base().well, bottomTempStatic: 100, surfaceTemp: 5 } })).exchange.interfaces[0];
  it("глубже и горячее — структура набирается быстрее, размыв меньше", () => {
    expect(mk(1000, 1050).bottomSmearM).toBeGreaterThan(mk(2600, 2650).bottomSmearM);
    expect(mk(1000, 1050).arrestMin).toBeGreaterThan(mk(2600, 2650).arrestMin);
  });
  it("длиннее мост — лёгкая жидкость не доходит до кровли", () => {
    const short = mk(2630, 2650, 300), long = mk(2550, 2650, 300);
    expect(long.topDropM).toBeLessThanOrEqual(short.topDropM);
  });
  it("дольше загустевание — больше обмен", () => {
    expect(mk(2600, 2650, 300).bottomSmearM).toBeGreaterThan(mk(2600, 2650, 90).bottomSmearM);
  });
});

import { evaluatePlugComplications, DEFAULT_COMPL_PARAMS } from "./cement-plug-complication-eval";

describe("Цементный мост: осложнения в итогах", () => {
  it("поглощение ниже моста меняет итоговое положение; проявление задаёт плотность", () => {
    const inp = base({ well: { ...base().well, bottomTempStatic: 90 } });
    const r = calculateBalancedPlug(inp);
    const loss = evaluatePlugComplications(inp, r, { ...DEFAULT_COMPL_PARAMS, type: "loss", lossRate: 20, zoneDepthMD: 2700, zoneThickness: 10 });
    expect(loss.active).toBe(true);
    expect(loss.realTopMD).toBeGreaterThanOrEqual(r.plugTopMD);
    const kick = evaluatePlugComplications(inp, r, { ...DEFAULT_COMPL_PARAMS, type: "kick", formationPressure: 40, zoneDepthMD: 2700 });
    expect(kick.requiredCementDensity).not.toBeNull();
    const off = evaluatePlugComplications(inp, r, { ...DEFAULT_COMPL_PARAMS, lossRate: 0 });
    expect(off.active).toBe(false);
  });
  it("автоподбор с проявлением не предлагает плотность ниже нужной", () => {
    const inp = base({ well: { ...base().well, bottomTempStatic: 90 } });
    const c = { ...DEFAULT_COMPL_PARAMS, type: "kick" as const, formationPressure: 48, zoneDepthMD: 2700 };
    const r = calculateBalancedPlug(inp);
    const need = evaluatePlugComplications(inp, r, c).requiredCementDensity ?? 0;
    const a = autoDesignPlug(inp, "abandonment", 24, 0.025, { complications: c });
    [a.best, ...a.alternatives].filter(Boolean).forEach((x) => expect(x!.densityGcm3).toBeGreaterThanOrEqual(Math.min(need, 1.85) - 1e-9));
  });
});
