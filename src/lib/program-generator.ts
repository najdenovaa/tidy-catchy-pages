/**
 * Generates a cementing program report from extracted well data
 * using existing calculation functions.
 */
import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid, VolumeResults, CementResults } from "./cementing-calculations";
import {
  getCasingID,
  pipeVolumePerMeter,
  annularVolumePerMeter,
  getSlurryHeight,
  getEffectiveTrajectory,
  interpolateTVD,
  totalPipeVolumeForRange,
} from "./cementing-calculations";

export function pipeVolumePerMeter_ext(idMm: number): number {
  return pipeVolumePerMeter(idMm);
}

export interface ProgramResult {
  markdown: string;
  volumeResults: VolumeResults | null;
  cementResults: CementResults[];
}

export function generateCementingProgram(
  wellData: WellData,
  drillingFluid: DrillingFluid,
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  displacementFluids: DisplacementFluid[],
): ProgramResult {
  const lines: string[] = [];
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const trajectory = getEffectiveTrajectory(wellData);

  lines.push("# Программа цементирования");
  lines.push("");
  lines.push("## 1. Исходные данные по скважине");
  lines.push("");
  lines.push(`| Параметр | Значение |`);
  lines.push(`|---|---|`);
  lines.push(`| Глубина скважины (MD) | ${wellData.wellDepthMD} м |`);
  lines.push(`| Глубина скважины (TVD) | ${wellData.wellDepthTVD || wellData.wellDepthMD} м |`);
  lines.push(`| Глубина спуска ОК (MD) | ${wellData.casingDepthMD} м |`);
  lines.push(`| Диаметр ствола | ${wellData.holeDiameter} мм |`);
  lines.push(`| Наружный диам. ОК | ${wellData.casingOD} мм |`);
  lines.push(`| Толщина стенки ОК | ${wellData.casingWall} мм |`);
  lines.push(`| Внутр. диам. ОК | ${casingID.toFixed(1)} мм |`);
  if (wellData.prevCasingDepth > 0) {
    lines.push(`| Глубина пред. колонны | ${wellData.prevCasingDepth} м |`);
    lines.push(`| Внутр. диам. пред. колонны | ${wellData.prevCasingID} мм |`);
  }
  lines.push(`| Глубина ЦКОД | ${wellData.ckodDepth} м |`);
  lines.push(`| Высота подъёма цемента | ${wellData.cementRiseHeight} м |`);
  lines.push(`| Коэф. кавернозности | ${wellData.cavernCoeff} |`);
  if (wellData.bottomTempStatic > 0) lines.push(`| BHST | ${wellData.bottomTempStatic} °C |`);
  if (wellData.bottomTempCirc > 0) lines.push(`| BHCT | ${wellData.bottomTempCirc} °C |`);
  lines.push("");

  // Drilling fluid
  lines.push("## 2. Буровой раствор");
  lines.push("");
  lines.push(`| Параметр | Значение |`);
  lines.push(`|---|---|`);
  lines.push(`| Название | ${drillingFluid.name || "—"} |`);
  lines.push(`| Плотность | ${drillingFluid.density} кг/м³ |`);
  lines.push(`| PV | ${drillingFluid.rheology.pv} сПз |`);
  lines.push(`| YP | ${drillingFluid.rheology.yp} Па |`);
  if (drillingFluid.fluidLoss > 0) lines.push(`| Водоотдача | ${drillingFluid.fluidLoss} мл/30мин |`);
  lines.push("");

  // Volume calculations
  const pipeVolPm = pipeVolumePerMeter(casingID);
  const openHoleVolPm = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, 1.0);
  const prevCasingAnnPm = wellData.prevCasingID > 0 ? annularVolumePerMeter(wellData.prevCasingID, wellData.casingOD, 1.0) : 0;

  // Zones
  const prevCasingBottom = wellData.prevCasingDepth > 0 ? wellData.prevCasingDepth : 0;
  const openHoleLength = Math.max(0, wellData.casingDepthMD - prevCasingBottom);
  const cementTopMD = wellData.cementRiseHeight > 0 ? wellData.cementRiseHeight : 0;

  const openHoleAnnVol = openHoleVolPm * openHoleLength * wellData.cavernCoeff;
  const prevCasingAnnVol = prevCasingBottom > cementTopMD ? prevCasingAnnPm * (prevCasingBottom - cementTopMD) : 0;
  const totalAnnVol = openHoleAnnVol + prevCasingAnnVol;

  const totalPipeVol = totalPipeVolumeForRange(0, wellData.ckodDepth || wellData.casingDepthMD, wellData.casingOD, wellData.casingWall, wellData.casingSections);
  const displacementVol = totalPipeVol;

  lines.push("## 3. Объёмные расчёты");
  lines.push("");
  lines.push(`| Параметр | Значение |`);
  lines.push(`|---|---|`);
  lines.push(`| Объём трубы (п.м.) | ${(pipeVolPm * 1000).toFixed(2)} л/м |`);
  lines.push(`| Объём затрубья (открытый ствол, п.м.) | ${(openHoleVolPm * 1000).toFixed(2)} л/м |`);
  if (prevCasingAnnPm > 0) lines.push(`| Объём затрубья (пред. колонна, п.м.) | ${(prevCasingAnnPm * 1000).toFixed(2)} л/м |`);
  lines.push(`| Общий объём затрубья | ${totalAnnVol.toFixed(2)} м³ |`);
  lines.push(`| Объём продавки (до ЦКОД) | ${displacementVol.toFixed(2)} м³ |`);
  lines.push("");

  // Buffers
  if (buffers.length > 0) {
    lines.push("## 4. Буферные жидкости");
    lines.push("");
    lines.push(`| № | Название | Плотность, кг/м³ | Объём, м³ |`);
    lines.push(`|---|---|---|---|`);
    buffers.forEach((b, i) => {
      lines.push(`| ${i + 1} | ${b.name || "Буфер"} | ${b.density} | ${b.volume.toFixed(2)} |`);
    });
    lines.push("");
  }

  // Slurries
  const cementResults: CementResults[] = [];
  if (slurries.length > 0) {
    lines.push("## 5. Тампонажные растворы");
    lines.push("");

    slurries.forEach((s, idx) => {
      const height = getSlurryHeight(slurries, idx, wellData.casingDepthMD);
      const densityKgM3 = s.density >= 10 ? s.density : s.density * 1000;

      // Determine volume: annular volume for this slurry's height range
      const slurryBottom = idx === slurries.length - 1 ? wellData.casingDepthMD : slurries[idx + 1].topDepthMD;
      const slurryTop = s.topDepthMD;
      
      // Simplified volume calc
      let vol = 0;
      // In open hole
      const ohTop = Math.max(slurryTop, prevCasingBottom);
      const ohBot = Math.min(slurryBottom, wellData.casingDepthMD);
      if (ohBot > ohTop) vol += openHoleVolPm * (ohBot - ohTop) * wellData.cavernCoeff;
      // In prev casing
      const pcTop = Math.max(slurryTop, cementTopMD);
      const pcBot = Math.min(slurryBottom, prevCasingBottom);
      if (pcBot > pcTop) vol += prevCasingAnnPm * (pcBot - pcTop);

      const dryMass = s.yieldPerTon > 0 ? vol / s.yieldPerTon : vol * densityKgM3 / 1000;
      const waterVol = s.waterRatio > 0 ? dryMass * s.waterRatio / 1000 : 0;

      cementResults.push({ slurryVolume: vol, dryMass, waterVolume: waterVol, yieldPerTon: s.yieldPerTon, waterCementRatio: s.waterRatio });

      lines.push(`### Раствор ${idx + 1}: ${s.name || `Тампонажный раствор №${idx + 1}`}`);
      lines.push("");
      lines.push(`| Параметр | Значение |`);
      lines.push(`|---|---|`);
      lines.push(`| Плотность | ${s.density} ${s.density >= 10 ? "кг/м³" : "г/см³"} |`);
      lines.push(`| Интервал | ${slurryTop} – ${slurryBottom} м |`);
      lines.push(`| Высота столба | ${height.toFixed(0)} м |`);
      lines.push(`| Объём | ${vol.toFixed(2)} м³ |`);
      lines.push(`| Сухая масса цемента | ${(dryMass * 1000).toFixed(0)} кг (${dryMass.toFixed(2)} т) |`);
      lines.push(`| В/Ц | ${s.waterRatio} |`);
      if (s.yieldPerTon > 0) lines.push(`| Выход раствора | ${s.yieldPerTon} м³/т |`);
      if (s.thickeningTime30Bc > 0) lines.push(`| Время загустевания (30 Bc) | ${s.thickeningTime30Bc} мин |`);
      if (s.thickeningTime50Bc > 0) lines.push(`| Время загустевания (50 Bc) | ${s.thickeningTime50Bc} мин |`);
      lines.push("");
    });
  }

  // Displacement
  lines.push("## 6. Продавочная жидкость");
  lines.push("");
  if (displacementFluids.length > 0) {
    const df = displacementFluids[0];
    lines.push(`| Параметр | Значение |`);
    lines.push(`|---|---|`);
    lines.push(`| Название | ${df.name || "Продавочная жидкость"} |`);
    lines.push(`| Плотность | ${df.density} кг/м³ |`);
    lines.push(`| Объём | ${displacementVol.toFixed(2)} м³ |`);
  } else {
    lines.push(`Объём продавки: ${displacementVol.toFixed(2)} м³`);
  }
  lines.push("");

  // Summary materials
  lines.push("## 7. Сводка материалов");
  lines.push("");
  const totalWaterCement = cementResults.reduce((s, c) => s + c.waterVolume, 0);
  const totalBufferVol = buffers.reduce((s, b) => s + b.volume, 0);
  const totalCementDry = cementResults.reduce((s, c) => s + c.dryMass, 0);
  lines.push(`| Материал | Количество |`);
  lines.push(`|---|---|`);
  lines.push(`| Сухой цемент (всего) | ${(totalCementDry * 1000).toFixed(0)} кг (${totalCementDry.toFixed(2)} т) |`);
  lines.push(`| Вода для затворения | ${totalWaterCement.toFixed(2)} м³ |`);
  lines.push(`| Буферная жидкость | ${totalBufferVol.toFixed(2)} м³ |`);
  lines.push(`| Продавочная жидкость | ${displacementVol.toFixed(2)} м³ |`);
  lines.push("");

  lines.push("---");
  lines.push("*Программа составлена на основе предоставленных исходных данных. DeAllsoft — виртуальный инженерный помощник.*");

  return {
    markdown: lines.join("\n"),
    volumeResults: null,
    cementResults,
  };
}
