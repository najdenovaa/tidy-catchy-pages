import { describe, it, expect } from "vitest";
import { burstMPa, collapseMPa, calculateRir, DEFAULT_RIR } from "./rir-calculations";

describe("РИР: прочность труб по API 5C3", () => {
  it("5½ дюйма 17 lb/ft N80: разрыв 7740 psi, смятие 6290 psi", () => {
    expect(burstMPa(139.7, 7.72, 552) / 0.00689476).toBeCloseTo(7740, -2);
    expect(collapseMPa(139.7, 7.72, 552).pMPa / 0.00689476).toBeCloseTo(6290, -2);
  });
  it("7 дюймов 23 lb/ft J55: смятие 3270 psi", () => {
    const c = collapseMPa(177.8, 8.05, 379);
    expect(c.pMPa / 0.00689476).toBeCloseTo(3270, -2);
  });
  it("2⅞ дюйма 6.5 lb/ft N80 НКТ: разрыв 10570 psi", () => {
    expect(burstMPa(73.0, 5.51, 552) / 0.00689476).toBeCloseTo(10570, -2);
  });
});

describe("РИР: диагностика и окно давлений", () => {
  const r = calculateRir(DEFAULT_RIR);
  it("приёмистость: линейная аппроксимация по забойному давлению", () => {
    expect(r.fit!.J).toBeGreaterThan(0);
    expect(r.fit!.r2).toBeGreaterThan(0.95);
    expect(r.fit!.points[0].bhpMPa).toBeGreaterThan(r.fit!.points[0].surfaceMPa);
  });
  it("окно давлений — минимум ограничений, на устье = забой − гидростатика состава", () => {
    const min = Math.min(...r.constraints.map((c) => c.limitBhpMPa));
    expect(r.maxBhpMPa).toBeCloseTo(min, 6);
    expect(r.maxSurfaceMPa).toBeGreaterThan(0);
    expect(r.maxSurfaceMPa).toBeCloseTo(r.maxBhpMPa - r.compositionDensity * 9.81 * r.leakTVD / 1000, 6);
  });
  it("выбор состава по раскрытию: широкий канал — цемент, узкий — микроцемент, микрозазор — смола", () => {
    const mk = (q: number) => calculateRir({ ...DEFAULT_RIR, injectivity: [{ rateM3h: q, surfacePressureMPa: 8 }, { rateM3h: q * 2, surfacePressureMPa: 12 }] }).composition;
    expect(mk(20)).toBe("cement");
    expect(mk(0.5)).toBe("microcement");
    expect(mk(0.002)).toBe("resin");
  });
  it("объём: под ретейнером + задавливание + запас; продавка = объём НКТ", () => {
    const v = r.volumes;
    expect(v.totalM3).toBeCloseTo(v.belowToolM3 + v.squeezeM3 + v.reserveM3, 9);
    expect(v.displacementM3).toBeCloseTo((Math.PI / 4) * ((73 - 11) / 1000) ** 2 * 1820, 3);
  });
  it("без пакера ограничение — разрыв колонны у устья", () => {
    const b = calculateRir({ ...DEFAULT_RIR, tool: { ...DEFAULT_RIR.tool, kind: "bradenhead" } });
    expect(b.constraints.some((c) => c.name.startsWith("Разрыв колонны у устья"))).toBe(true);
  });
  it("ход работ сформирован, время жизни состава ≥ работа/0,75", () => {
    expect(r.workProgram.length).toBeGreaterThan(6);
    expect(r.timing.requiredWorkLifeMin).toBeGreaterThanOrEqual(r.timing.jobMin / 0.75);
  });
});
