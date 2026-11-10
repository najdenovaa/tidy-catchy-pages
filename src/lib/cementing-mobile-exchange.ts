/**
 * Interop with the published Rork offline cementing calculator.
 * This is an explicitly lossy field-level transfer, not a claim of identical physics.
 * No user credentials or server-side calculation results are included.
 */
import type { CementingSnapshot } from "./cementing-normalizers";
import { normalizeCementingSnapshot } from "./cementing-normalizers";
import { calculateVolumes, resolveFlowRateSteps, buildDisplacementSchedule } from "./cementing-calculations";

const FIELD_RE = /\[([A-Za-z0-9_.]+)\]\s*:\s*(.*)$/;
const num = (v: string | undefined, fallback = 0) => {
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v.trim().replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};
const mobileDensity = (n: number) => (n > 20 ? n / 1000 : n);
const webDensity = (n: number) => (n > 20 ? n : n * 1000);
const line = (name: string, key: string, value: string | number) => `${name} [${key}]: ${value}`;
export const MAX_EXCHANGE_LENGTH = 150_000;
export const MOBILE_EXCHANGE_WARNING = "Мобильная версия применяет упрощённую гидравлику. Реальная траектория, интервальная кавернозность, Fann, рецептуры и дополнительные проверки веб-версии не передаются. После импорта заново проверьте результаты и расчётные давления.";

export function parseMobileCementingText(text: string): Record<string, string> {
  if (text.length > MAX_EXCHANGE_LENGTH) throw new Error("Сообщение превышает допустимый размер");
  const map: Record<string, string> = Object.create(null);
  for (const raw of text.split(/\r?\n/)) {
    const match = FIELD_RE.exec(raw.trim());
    if (match && match[1] !== "__proto__" && match[1] !== "constructor" && match[1] !== "prototype") {
      map[match[1]] = match[2].trim();
    }
  }
  if (map.module !== "cementing") throw new Error("Это не расчёт цементирования ОК из приложения DeAllsoft");
  if (!map.casingDepthMD || !map.casingOD || !map.holeDiameter) throw new Error("В сообщении отсутствуют основные размеры скважины");
  return map;
}

function requiredNumber(map: Record<string,string>, key: string, min = 0, max = 100000): number {
  const raw = map[key];
  if (raw == null || raw.trim() === "") throw new Error(`Не заполнено обязательное поле ${key}`);
  const v = num(raw, NaN);
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Недопустимое значение ${key}`);
  return v;
}

export function exportCementingToMobileText(input: CementingSnapshot): string {
  const s = normalizeCementingSnapshot(input);
  const w = s.wellData;
  const rows = [
    "РАСЧЁТ: Цементирование ОК",
    "[module]: cementing",
    "[exchangeVersion]: 1",
    "Исходные данные DeAllsoft. Можно отправить как сообщение в Telegram, MAX или почту.",
    MOBILE_EXCHANGE_WARNING,
    line("Режим", "mode", "advanced"),
    line("Глубина башмака ОК, MD, м", "casingDepthMD", w.casingDepthMD),
    line("Забой скважины, MD, м", "wellTotalDepthMD", w.wellDepthMD),
    line("Глубина башмака, TVD, м", "casingDepthTVD", w.trajectory?.length > 1 ? (w.trajectory.find(p => p.md === w.casingDepthMD)?.tvd ?? (w.wellDepthMD ? w.wellDepthTVD * w.casingDepthMD / w.wellDepthMD : w.casingDepthMD)) : (w.wellDepthMD ? (w.wellDepthTVD || w.wellDepthMD) * w.casingDepthMD / w.wellDepthMD : w.casingDepthMD)),
    line("Диаметр долота, мм", "holeDiameter", w.holeDiameter),
    line("Кавернозность", "cavernCoeff", w.cavernCoeff),
    line("Диаметр ОК, мм", "casingOD", w.casingOD),
    line("Стенка ОК, мм", "casingWall", w.casingWall),
    line("Башмак предыдущей ОК, м", "prevCasingDepth", w.prevCasingDepth),
    line("Внутренний диаметр предыдущей ОК, мм", "prevCasingID", w.prevCasingID),
    line("Глубина ЦКОД, м", "ckodDepth", w.ckodDepth),
    line("Буровой раствор, г/см3", "mudDensity", mobileDensity(s.drillingFluid.density)),
    line("Кровля цемента, MD, м", "cementTopMD", s.slurries[0]?.topDepthMD ?? w.cementRiseHeight),
  ];
  s.slurries.forEach((v, i) => {
    const n = i + 1;
    const bottom = s.slurries[i+1]?.topDepthMD ?? w.casingDepthMD;
    rows.push(line(`Раствор ${n}, название`, `stage${n}.label`, v.name),
      line(`Раствор ${n}, подошва, MD`, `stage${n}.bottomMD`, bottom),
      line(`Раствор ${n}, плотность, г/см3`, `stage${n}.densityGcm3`, mobileDensity(v.density)),
      line(`Раствор ${n}, В/Ц`, `stage${n}.waterRatio`, v.waterRatio),
      line(`Раствор ${n}, выход, м3/т`, `stage${n}.yieldPerTon`, v.yieldPerTon),
      line(`Раствор ${n}, расход, л/с`, `stage${n}.rateLps`, v.flowRateSteps[0]?.rateLps ?? 0));
  });
  s.buffers.forEach((v, i) => {
    const n = i + 1;
    rows.push(line(`Буфер ${n}, название`, `spacer${n}.label`, v.name),
      line(`Буфер ${n}, объём, м3`, `spacer${n}.volumeM3`, v.volume),
      line(`Буфер ${n}, плотность, г/см3`, `spacer${n}.densityGcm3`, mobileDensity(v.density)));
  });
  const bufferSteps = s.buffers.flatMap(v => resolveFlowRateSteps(v.flowRateSteps, v.volume));
  bufferSteps.forEach((step,i) => {
    rows.push(line(`Буфер, расход ${i+1}, л/с`,`bufferStep${i+1}.rateLps`,step.rateLps));
    rows.push(line(`Буфер, объём ${i+1}, м3`,`bufferStep${i+1}.volumeM3`,step.volumeM3));
  });
  const disp = s.displacementFluids[0];
  buildDisplacementSchedule(s.displacementFluids, calculateVolumes(s.wellData, s.slurries, disp?.compressionCoeff ?? 1).displacementVolumeWithCompression).forEach((step,i) => {
    rows.push(line(`Продавка, расход ${i+1}, л/с`,`dispStep${i+1}.rateLps`,step.rateLps));
    rows.push(line(`Продавка, объём ${i+1}, м3`,`dispStep${i+1}.volumeM3`,step.volumeM3));
  });
  rows.push(line("Продавочная жидкость, г/см3", "dispDensity", mobileDensity(disp?.density ?? s.drillingFluid.density)),
    line("Сжимаемость", "compressionCoeff", disp?.compressionCoeff ?? 1),
    line("Градиент ГРП, г/см3", "fracGradientGcm3", s.fractureGradient / 9.81),
    line("Буровой раствор, ПВ", "mudPV", s.drillingFluid.rheology.pv),
    line("Буровой раствор, ДНС", "mudYP", s.drillingFluid.rheology.yp),
    line("Буфер, ПВ", "bufferPV", s.buffers[0]?.rheology.pv ?? 0),
    line("Буфер, ДНС", "bufferYP", s.buffers[0]?.rheology.yp ?? 0),
    line("Цемент, ПВ", "cementPV", s.slurries[0]?.rheology.pv ?? 0),
    line("Цемент, ДНС", "cementYP", s.slurries[0]?.rheology.yp ?? 0),
    line("Продавка, ПВ", "dispPV", disp?.rheology.pv ?? 0),
    line("Продавка, ДНС", "dispYP", disp?.rheology.yp ?? 0));
  s.slurries.forEach((v,i)=> {
    rows.push(line(`Раствор ${i+1}, ПВ`, `stage${i+1}.pvCp`, v.rheology.pv),
      line(`Раствор ${i+1}, ДНС`, `stage${i+1}.ypPa`, v.rheology.yp));
  });
  return rows.join("\n");
}

export function importMobileCementingText(text: string, current: CementingSnapshot): CementingSnapshot {
  const m = parseMobileCementingText(text);
  const base = normalizeCementingSnapshot(current);
  const w = base.wellData;
  const casingDepthMD = requiredNumber(m, "casingDepthMD", 1);
  const casingOD = requiredNumber(m, "casingOD", 1, 1000);
  const holeDiameter = requiredNumber(m, "holeDiameter", 1, 1500);
  if (holeDiameter <= casingOD) throw new Error("Диаметр долота не должен быть меньше или равен диаметру ОК");
  const tvd = requiredNumber(m, "casingDepthTVD", 0);
  if (tvd > casingDepthMD) throw new Error("TVD башмака не может превышать MD");
  const wellDepthMD = num(m.wellTotalDepthMD, casingDepthMD) || casingDepthMD;
  if (wellDepthMD < casingDepthMD) throw new Error("Забой не может быть выше башмака ОК");
  const stageIndices = Object.keys(m).map(k => /^stage(\d+)\.densityGcm3$/.exec(k)?.[1]).filter(Boolean).map(Number);
  const maxStage = Math.max(0, ...stageIndices);
  if (maxStage < 1 || maxStage > 20) throw new Error("В сообщении отсутствуют цементные стадии либо их слишком много");
  const slurries = Array.from({length:maxStage}, (_,i) => {
    const n = i+1;
    const top = n === 1 ? num(m.cementTopMD, 0) : num(m[`stage${n-1}.bottomMD`], 0);
    const density = requiredNumber(m, `stage${n}.densityGcm3`, 0.8, 3.5);
    const nextBottom = num(m[`stage${n}.bottomMD`], casingDepthMD);
    if (top >= nextBottom || nextBottom > casingDepthMD) throw new Error(`Неверные границы цемента, стадия ${n}`);
    return {
      name: m[`stage${n}.label`] || `Раствор ${n}`,
      density: webDensity(density), topDepthMD: top,
      rheology: {pv:num(m[`stage${n}.pvCp`],num(m.cementPV,0)),yp:num(m[`stage${n}.ypPa`],num(m.cementYP,0))},
      additives: [], thickeningTime30Bc: 0, thickeningTime50Bc: 0,
      flowRateSteps: [{rateLps:num(m[`stage${n}.rateLps`],0),volumeM3:0}],
      waterRatio:num(m[`stage${n}.waterRatio`],0),yieldPerTon:num(m[`stage${n}.yieldPerTon`],0),
    };
  });
  if (Math.abs(num(m[`stage${maxStage}.bottomMD`],casingDepthMD)-casingDepthMD)>0.01) throw new Error("Подошва последнего цементного раствора должна совпадать с башмаком ОК");
  const spacerIndices = Object.keys(m).map(k => /^spacer(\d+)\.volumeM3$/.exec(k)?.[1]).filter(Boolean).map(Number);
  const maxSpacer = Math.max(0,...spacerIndices);
  if (maxSpacer > 20) throw new Error("Слишком много буферных жидкостей");
  const buffers = Array.from({length:maxSpacer},(_,i) => ({
    name:m[`spacer${i+1}.label`]||`Буфер ${i+1}`,density:webDensity(requiredNumber(m,`spacer${i+1}.densityGcm3`,0.5,3.5)),
    volume:requiredNumber(m,`spacer${i+1}.volumeM3`,0,100000),
    rheology:{pv:num(m.bufferPV,0),yp:num(m.bufferYP,0)},additives:[],flowRateSteps:[{rateLps:num(m["bufferStep1.rateLps"],num(m["stage1.rateLps"],0)),volumeM3:num(m[`spacer${i+1}.volumeM3`],0)}],
  }));
  const mudDensity = webDensity(requiredNumber(m,"mudDensity",0.5,3.5));
  const displacementDensity = webDensity(num(m.dispDensity,mudDensity/1000));
  const next = normalizeCementingSnapshot({
    ...base,
    // Deliberately reset detailed web-only parameters rather than accidentally
    // combining a mobile calculation with trajectory and geology from another well.
    wellData: {
      ...w, wellDepthMD,wellDepthTVD:wellDepthMD ? tvd*wellDepthMD/casingDepthMD : tvd,
      casingDepthMD,holeDiameter,casingOD,
      casingWall:num(m.casingWall,0),prevCasingDepth:num(m.prevCasingDepth,0),
      prevCasingID:num(m.prevCasingID,0),ckodDepth:num(m.ckodDepth,0),
      cavernCoeff:num(m.cavernCoeff,1),cementRiseHeight:num(m.cementTopMD,0),
      trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:casingDepthMD,tvd,zenith:0,azimuth:0},{md:wellDepthMD,tvd:wellDepthMD ? tvd*wellDepthMD/casingDepthMD : tvd,zenith:0,azimuth:0}].filter((p,i,a)=>i===0 || p.md>a[i-1].md),
      casingSections:undefined,cavernIntervals:undefined,reservoirLayers:[],
      standoffProfile:undefined,
    },
    drillingFluid:{name:"Буровой раствор",density:mudDensity,rheology:{pv:num(m.mudPV,0),yp:num(m.mudYP,0)},fluidLoss:0},
    slurries,buffers,
    displacementFluids:[{name:"Продавочная жидкость",density:displacementDensity,rheology:{pv:num(m.dispPV,0),yp:num(m.dispYP,0)},flowRateSteps:[{rateLps:num(m["dispStep1.rateLps"],0),volumeM3:0}],compressionCoeff:num(m.compressionCoeff,1)}],
    fractureGradient:num(m.fracGradientGcm3,0)*9.81,
    flushTimeMin:0,flushVolumeM3:0,
  });
  // Reconstruct stage pumping volumes using the web engine's geometry, because
  // the mobile text format records rate and interval but not per-stage volume.
  const volumes = calculateVolumes(next.wellData, next.slurries, next.displacementFluids[0]?.compressionCoeff ?? 1);
  next.slurries = next.slurries.map((slurry, i) => ({
    ...slurry, flowRateSteps: slurry.flowRateSteps.map((step, j) => ({
      ...step, volumeM3: j === 0 ? (volumes.slurryVolumes[i]?.slurryVolumeM3 ?? 0) : step.volumeM3,
    })),
  }));
  next.displacementFluids = next.displacementFluids.map((fluid, i) => ({
    ...fluid, flowRateSteps: fluid.flowRateSteps.map((step, j) => ({
      ...step, volumeM3: i === 0 && j === 0 ? volumes.displacementVolume : step.volumeM3,
    })),
  }));
  return next;
}
