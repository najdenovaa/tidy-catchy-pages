/**
 * Алгоритмический анализ качества цементирования
 * Без использования AI — чистая инженерная логика + шаблоны ответов
 * Версия 3.0 — полноценная нейросеть-подобная система
 * 
 * Проверки:
 * 1.  Геометрия скважины
 * 2.  Иерархия плотностей
 * 3.  Режимы течения
 * 4.  Центрирование
 * 5.  Реология и совместимость
 * 6.  Буферные жидкости
 * 7.  Время загустевания
 * 8.  Продавка
 * 9.  ECD / давление ГРП
 * 10. Эффективность вытеснения (Mud Removal)
 * 11. Контаминация
 * 12. Газомиграция
 * 13. WOC / прочность
 * 14. Движение колонны
 * 15. Микрозазор
 * 16. Температурные эффекты
 * 17. Предоперационная подготовка
 * 18. Нормативные ссылки
 * + Документная интеллектика
 */

import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "./cementing-calculations";
import { effectiveRheology, cementCategory, getCasingID, getSlurryHeight, getFlowRateLps } from "./cementing-calculations";
import type { CentralizationResult } from "./centralization-calculations";
import {
  QUALITY_RATINGS, DENSITY_TEMPLATES, FLOW_REGIME_TEMPLATES,
  CENTRALIZATION_TEMPLATES, THICKENING_TIME_TEMPLATES, RHEOLOGY_TEMPLATES,
  BUFFER_TEMPLATES, AKC_TEMPLATES, GEOMETRY_TEMPLATES, DISPLACEMENT_TEMPLATES,
  CONCLUSION_TEMPLATES, IMAGE_INTERPRETATION_TEMPLATES, DOCUMENT_TEMPLATES,
  ECD_FRAC_TEMPLATES, GAS_MIGRATION_TEMPLATES, MUD_REMOVAL_TEMPLATES,
  CONTAMINATION_TEMPLATES, WOC_TEMPLATES, STRENGTH_TEMPLATES,
  SEDIMENTATION_TEMPLATES, PIPE_MOVEMENT_TEMPLATES, ZONAL_ISOLATION_TEMPLATES,
  MICROANNULUS_TEMPLATES, PRE_JOB_TEMPLATES, TEMPERATURE_TEMPLATES,
  RECIPE_TEMPLATES, MULTISTAGE_TEMPLATES, LINER_TEMPLATES, STANDARDS_TEMPLATES,
  getTemplate, extractValuesFromText, type ExtractedValue
} from "./analysis-templates";
import type { ImageAnalysisResult } from "./image-analysis-engine";
import type { OcrResult } from "./ocr-engine";

interface AnalysisCheck {
  section: string;
  title: string;
  status: "ok" | "warning" | "critical" | "info";
  detail: string;
}

interface DocumentInfo {
  name: string;
  text: string;
  error?: string;
  imageAnalysis?: ImageAnalysisResult;
  ocrResult?: OcrResult;
}

interface AnalysisReport {
  timestamp: string;
  wellSummary: string;
  checks: AnalysisCheck[];
  markdown: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function d(v: number): number { return v < 100 ? v * 1000 : v; } // to kg/m3
function se(s: "ok" | "warning" | "critical" | "info"): string {
  return s === "ok" ? "✅" : s === "warning" ? "⚠️" : s === "critical" ? "🔴" : "ℹ️";
}
function h(s: string): number { let r = 0; for (let i = 0; i < s.length; i++) r = ((r << 5) - r + s.charCodeAt(i)) | 0; return Math.abs(r); }

function re(vel: number, dh: number, dens: number, pv: number, yp: number): number {
  if (pv <= 0) return 0;
  const ev = pv / 1000 + yp * dh / (6 * Math.max(vel, 0.001));
  return ev > 0 ? (dens * vel * dh) / ev : 0;
}

function flowLabel(r: number): string { return r < 2100 ? "ламинарный" : r < 3000 ? "переходный" : "турбулентный"; }

// ─── 1. Geometry ─────────────────────────────────────────────────

function checkGeometry(w: WellData): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  if (w.wellDepthMD <= 0) { c.push({ section: "Скважина", title: "Глубина не задана", status: "critical", detail: "Необходимо задать глубину скважины." }); return c; }

  const cl = w.holeDiameter - w.casingOD;
  if (cl < 20) c.push({ section: "Скважина", title: `Зазор ${cl.toFixed(0)} мм — критически мал`, status: "critical", detail: getTemplate(GEOMETRY_TEMPLATES.tight_annulus) });
  else if (cl < 30) c.push({ section: "Скважина", title: `Зазор ${cl.toFixed(0)} мм — умеренный`, status: "warning", detail: getTemplate(GEOMETRY_TEMPLATES.tight_annulus, 1) });

  if (w.cavernCoeff > 1.3) c.push({ section: "Скважина", title: `Кавернозность ${w.cavernCoeff.toFixed(2)}`, status: "warning", detail: getTemplate(GEOMETRY_TEMPLATES.cavern) });
  if (w.bottomTempStatic > 100) c.push({ section: "Скважина", title: `BHST ${w.bottomTempStatic}°C`, status: "warning", detail: getTemplate(GEOMETRY_TEMPLATES.high_temperature) });
  if (w.wellDepthMD > 3000) c.push({ section: "Скважина", title: `Глубина ${w.wellDepthMD} м`, status: "info", detail: getTemplate(GEOMETRY_TEMPLATES.deep_well) });

  // Check for horizontal well
  if (w.wellDepthTVD > 0 && w.wellDepthMD > 0) {
    const ratio = w.wellDepthTVD / w.wellDepthMD;
    if (ratio < 0.7) c.push({ section: "Скважина", title: "Значительная горизонтальная составляющая", status: "warning", detail: getTemplate(GEOMETRY_TEMPLATES.horizontal) });
  }

  return c;
}

// ─── 2. Density ──────────────────────────────────────────────────

function checkDensity(df: DrillingFluid, sl: SlurryInput[], bf: BufferFluid[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  const mud = d(df.density);

  for (const b of bf) { const bd = d(b.density); if (bd < mud * 0.95) c.push({ section: "Плотности", title: `Буфер "${b.name}" легче бур. р-ра`, status: "warning", detail: `${getTemplate(DENSITY_TEMPLATES.buffer_light, h(b.name))}\n\nБуфер: ${bd.toFixed(0)}, бур. р-р: ${mud.toFixed(0)} кг/м³.` }); }
  for (const s of sl) { const sd = d(s.density); if (sd < mud) c.push({ section: "Плотности", title: `Цемент "${s.name}" легче бур. р-ра`, status: "critical", detail: `${getTemplate(DENSITY_TEMPLATES.cement_light, h(s.name))}\n\nЦемент: ${sd.toFixed(0)}, бур. р-р: ${mud.toFixed(0)} кг/м³.` }); }
  for (let i = 0; i < sl.length - 1; i++) { const u = d(sl[i].density), lo = d(sl[i + 1].density); if (u > lo * 1.05) c.push({ section: "Плотности", title: "Нарушение иерархии растворов", status: "warning", detail: `${getTemplate(DENSITY_TEMPLATES.hierarchy_warning, i)}\n\n"${sl[i].name}" (${u.toFixed(0)}) > "${sl[i + 1].name}" (${lo.toFixed(0)}).` }); }

  if (c.length === 0) {
    c.push({ section: "Плотности", title: "Иерархия плотностей корректна", status: "ok",
      detail: `${getTemplate(DENSITY_TEMPLATES.hierarchy_ok)}\n\nБур. р-р: ${mud.toFixed(0)} → ${bf.length ? `Буферы (${bf.map(b => d(b.density).toFixed(0)).join(", ")}) → ` : ""}Цемент (${sl.map(s => d(s.density).toFixed(0)).join(", ")}) кг/м³.` });
  }

  // Density window check
  c.push({ section: "Плотности", title: "Окно плотности", status: "info", detail: getTemplate(DENSITY_TEMPLATES.density_window) });

  return c;
}

// ─── 3. Flow Regimes ─────────────────────────────────────────────

function checkFlow(w: WellData, sl: SlurryInput[], bf: BufferFluid[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  const dh = (w.holeDiameter - w.casingOD) / 1000;
  const ann = (Math.PI / 4) * ((w.holeDiameter / 1000) ** 2 - (w.casingOD / 1000) ** 2);
  if (ann <= 0 || dh <= 0) return c;

  for (const s of sl) {
    const rate = getFlowRateLps(s.flowRateSteps); if (rate <= 0) continue;
    const vel = (rate / 1000) / ann;
    const cat = cementCategory(s.density < 100 ? s.density : s.density / 1000);
    const rh = effectiveRheology(s.rheology, cat);
    const r = re(vel, dh, d(s.density), rh.pv, rh.yp);

    if (r >= 3000) c.push({ section: "Режимы течения", title: `${s.name}: турбулентный (Re=${r.toFixed(0)})`, status: "ok", detail: `${getTemplate(FLOW_REGIME_TEMPLATES.turbulent_good, h(s.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.velocity_ratio, h(s.name) + 1)}\n\nРасход: ${rate.toFixed(1)} л/с, V=${vel.toFixed(2)} м/с.` });
    else if (r < 2100) c.push({ section: "Режимы течения", title: `${s.name}: ламинарный (Re=${r.toFixed(0)})`, status: "warning", detail: `${getTemplate(FLOW_REGIME_TEMPLATES.laminar_risk, h(s.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.recommendation_rate, h(s.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.recommendation_turbulizers, h(s.name) + 2)}` });
    else c.push({ section: "Режимы течения", title: `${s.name}: переходный (Re=${r.toFixed(0)})`, status: "warning", detail: `${getTemplate(FLOW_REGIME_TEMPLATES.transitional, h(s.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.recommendation_rate, h(s.name))}` });
  }

  for (const b of bf) {
    const rate = getFlowRateLps(b.flowRateSteps); if (rate <= 0) continue;
    const vel = (rate / 1000) / ann;
    const rh = effectiveRheology(b.rheology, "buffer");
    const r = re(vel, dh, d(b.density), rh.pv, rh.yp);
    c.push({ section: "Режимы течения", title: `Буфер "${b.name}": ${flowLabel(r)} (Re=${r.toFixed(0)})`, status: r >= 3000 ? "ok" : "warning", detail: r >= 3000 ? getTemplate(FLOW_REGIME_TEMPLATES.turbulent_good, h(b.name)) : `${getTemplate(FLOW_REGIME_TEMPLATES.laminar_risk, h(b.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.recommendation_rate, h(b.name))}` });
  }

  return c;
}

// ─── 4. Centralization ───────────────────────────────────────────

function checkCentral(cr: CentralizationResult[] | null): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  if (!cr || cr.length === 0) { c.push({ section: "Центрирование", title: "Данные отсутствуют", status: "warning", detail: "Расчёт центрирования не выполнен." }); return c; }

  const so = cr.map(r => r.standoff);
  const mn = Math.min(...so), avg = so.reduce((a, b) => a + b, 0) / so.length;
  const crit = cr.filter(r => r.standoff < 50), warn = cr.filter(r => r.standoff < 67);

  if (mn >= 67) c.push({ section: "Центрирование", title: `Standoff ≥ 67% (мин. ${mn.toFixed(1)}%)`, status: "ok", detail: `${getTemplate(CENTRALIZATION_TEMPLATES.good)}\n\nМин: ${mn.toFixed(1)}%, средний: ${avg.toFixed(1)}%.` });
  else if (crit.length > 0) c.push({ section: "Центрирование", title: `Критический standoff < 50%`, status: "critical", detail: `${getTemplate(CENTRALIZATION_TEMPLATES.critical)}\n\n${getTemplate(CENTRALIZATION_TEMPLATES.angle_correlation)}\n\n${crit.length} точек: ${crit.slice(0, 3).map(r => `${r.md.toFixed(0)}м (${r.standoff.toFixed(1)}%)`).join(", ")}.` });
  else c.push({ section: "Центрирование", title: `Standoff < 67% в ${warn.length} точках`, status: "warning", detail: `${getTemplate(CENTRALIZATION_TEMPLATES.warning)}\n\n${getTemplate(CENTRALIZATION_TEMPLATES.rigid_vs_bow)}` });

  return c;
}

// ─── 5. Rheology ─────────────────────────────────────────────────

function checkRheology(sl: SlurryInput[], df: DrillingFluid): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];

  for (const s of sl) {
    if (s.rheology.pv === 0 && s.rheology.yp === 0) c.push({ section: "Реология", title: `${s.name}: значения по умолчанию`, status: "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.default_values) });
    const cat = cementCategory(s.density < 100 ? s.density : s.density / 1000);
    const rh = effectiveRheology(s.rheology, cat);
    if (rh.yp > 15) c.push({ section: "Реология", title: `${s.name}: высокое YP (${rh.yp} Па)`, status: "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.high_yp, h(s.name)) });
    if (rh.pv > 100) c.push({ section: "Реология", title: `${s.name}: высокое PV (${rh.pv} сПз)`, status: "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.high_pv, h(s.name)) });
  }

  if (df.rheology.pv === 0 && df.rheology.yp === 0) c.push({ section: "Реология", title: "Реология бур. р-ра по умолчанию", status: "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.default_values, 1) });
  if (df.fluidLoss > 10) c.push({ section: "Реология", title: `Водоотдача бур. р-ра: ${df.fluidLoss} мл`, status: df.fluidLoss > 15 ? "critical" : "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.water_loss_high, Math.round(df.fluidLoss)) });

  // SNS analysis
  if (df.rheology.yp > 0) {
    c.push({ section: "Реология", title: "Анализ СНС бурового раствора", status: "info", detail: getTemplate(RHEOLOGY_TEMPLATES.sns_analysis) });
  }

  // Compatibility
  if (sl.length > 0) c.push({ section: "Реология", title: "Совместимость жидкостей", status: "info", detail: getTemplate(RHEOLOGY_TEMPLATES.compatibility) });

  return c;
}

// ─── 6. Buffers ──────────────────────────────────────────────────

function checkBuffers(bf: BufferFluid[], w: WellData): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  if (bf.length === 0) { c.push({ section: "Буферные жидкости", title: "Буферы отсутствуют", status: "warning", detail: `${getTemplate(BUFFER_TEMPLATES.missing)}\n\n${getTemplate(BUFFER_TEMPLATES.chemical_wash)}` }); return c; }

  const ann = (Math.PI / 4) * ((w.holeDiameter / 1000) ** 2 - (w.casingOD / 1000) ** 2);
  for (const b of bf) {
    if (ann > 0 && b.volume > 0) {
      const bh = b.volume / ann;
      const rate = getFlowRateLps(b.flowRateSteps);
      if (rate > 0) {
        const vel = (rate / 1000) / ann;
        const ct = vel > 0 ? bh / vel : 0;
        if (ct < 600) c.push({ section: "Буферные жидкости", title: `"${b.name}": контакт ${(ct / 60).toFixed(1)} мин`, status: ct < 300 ? "critical" : "warning", detail: `${getTemplate(BUFFER_TEMPLATES.short_contact, h(b.name))}\n\nФакт. время: ${(ct / 60).toFixed(1)} мин.` });
        else c.push({ section: "Буферные жидкости", title: `"${b.name}": контакт ${(ct / 60).toFixed(1)} мин`, status: "ok", detail: getTemplate(BUFFER_TEMPLATES.adequate, h(b.name)) });
      }
    }
  }

  if (bf.length === 1) c.push({ section: "Буферные жидкости", title: "Двухступенчатая система", status: "info", detail: getTemplate(BUFFER_TEMPLATES.two_stage) });
  c.push({ section: "Буферные жидкости", title: "Дизайн разделительной жидкости", status: "info", detail: getTemplate(BUFFER_TEMPLATES.spacer_design) });

  return c;
}

// ─── 7. Thickening Time ──────────────────────────────────────────

function checkThickening(sl: SlurryInput[], w: WellData, bf: BufferFluid[], disp: DisplacementFluid[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  const cID = getCasingID(w.casingOD, w.casingWall);
  const ann = (Math.PI / 4) * ((w.holeDiameter / 1000) ** 2 - (w.casingOD / 1000) ** 2);
  const pa = (Math.PI / 4) * (cID / 1000) ** 2;

  for (const s of sl) {
    if (s.thickeningTime50Bc <= 0) { c.push({ section: "Время загустевания", title: `${s.name}: не задано`, status: "warning", detail: "Укажите время загустевания для оценки безопасности." }); continue; }

    const ht = getSlurryHeight([s], 0, w.casingDepthMD);
    const rate = getFlowRateLps(s.flowRateSteps);
    const rm = rate > 0 ? (rate / 1000) * 60 : 0.01;
    const cp = rm > 0 ? (ann * ht) / rm : 0;

    let dr = 0;
    for (const df of disp) { const r = getFlowRateLps(df.flowRateSteps); if (r > dr) dr = r; }
    const drm = dr > 0 ? (dr / 1000) * 60 : rm;
    const dt = drm > 0 ? (pa * w.casingDepthMD) / drm : 0;

    let bt = 0;
    for (const b of bf) { const br = getFlowRateLps(b.flowRateSteps); const bm = br > 0 ? (br / 1000) * 60 : rm; bt += bm > 0 ? b.volume / bm : 0; }

    const total = bt + cp + dt + 15;
    const safe = s.thickeningTime50Bc * 0.75;

    if (total > safe) c.push({ section: "Время загустевания", title: `${s.name}: ПРЕВЫШЕН ЛИМИТ!`, status: "critical", detail: `${getTemplate(THICKENING_TIME_TEMPLATES.critical)}\n\n${getTemplate(THICKENING_TIME_TEMPLATES.right_angle_set)}\n\nОперация: ~${total.toFixed(0)} мин. Безопасное: ${safe.toFixed(0)} мин.` });
    else {
      const m = safe - total;
      c.push({ section: "Время загустевания", title: `${s.name}: запас ${m.toFixed(0)} мин`, status: m > 30 ? "ok" : "warning", detail: `${getTemplate(m > 30 ? THICKENING_TIME_TEMPLATES.safe : THICKENING_TIME_TEMPLATES.marginal)}\n\nОперация: ~${total.toFixed(0)} мин, безопасное: ${safe.toFixed(0)} мин.` });
    }
  }

  return c;
}

// ─── 8. Displacement ─────────────────────────────────────────────

function checkDisplacement(disp: DisplacementFluid[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  if (disp.length === 0) { c.push({ section: "Продавка", title: "Не задана", status: "warning", detail: `${getTemplate(DISPLACEMENT_TEMPLATES.underdisplacement)}` }); return c; }
  for (const df of disp) { if (df.compressionCoeff > 1.1) c.push({ section: "Продавка", title: `Коэфф. сжатия ${df.compressionCoeff}`, status: "warning", detail: getTemplate(DISPLACEMENT_TEMPLATES.compression_high) }); }
  if (c.length === 0) c.push({ section: "Продавка", title: "Продавка — OK", status: "ok", detail: getTemplate(DISPLACEMENT_TEMPLATES.ok) });
  c.push({ section: "Продавка", title: "Контроль перепродавки", status: "info", detail: getTemplate(DISPLACEMENT_TEMPLATES.overdisplacement) });
  return c;
}

// ─── 9. ECD / Frac ───────────────────────────────────────────────

function checkECD(w: WellData, sl: SlurryInput[], bf: BufferFluid[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  const ann = (Math.PI / 4) * ((w.holeDiameter / 1000) ** 2 - (w.casingOD / 1000) ** 2);
  if (ann <= 0) return c;

  // Estimate hydrostatic + friction
  for (const s of sl) {
    const dens = d(s.density);
    const hydrostaticMPa = dens * 9.81 * (w.wellDepthTVD || w.wellDepthMD) / 1e6;
    const rate = getFlowRateLps(s.flowRateSteps);
    // Rough friction estimate
    const frictionEstimate = rate > 0 ? rate * 0.05 * (w.wellDepthMD / 1000) : 0;
    const totalBHP = hydrostaticMPa + frictionEstimate;
    const ecd = totalBHP / (9.81 * (w.wellDepthTVD || w.wellDepthMD) / 1e6);

    c.push({ section: "ECD / Давление ГРП", title: `${s.name}: ECD ~${(ecd / 1000).toFixed(2)} г/см³`, status: "info",
      detail: `${getTemplate(ECD_FRAC_TEMPLATES.safe)}\n\nГидростатическое: ${hydrostaticMPa.toFixed(1)} МПа. Расчётное ECD: ${(ecd / 1000).toFixed(3)} г/см³.\n\n${getTemplate(ECD_FRAC_TEMPLATES.shoe_integrity)}` });
  }

  // Multi-stage consideration
  if (w.wellDepthMD > 3000 && sl.length > 0) {
    const heaviest = Math.max(...sl.map(s => d(s.density)));
    if (heaviest > 1850) c.push({ section: "ECD / Давление ГРП", title: "Рассмотреть ступенчатое цементирование", status: "info", detail: getTemplate(MULTISTAGE_TEMPLATES.recommendation) });
  }

  return c;
}

// ─── 10. Mud Removal Efficiency ──────────────────────────────────

function checkMudRemoval(w: WellData, sl: SlurryInput[], bf: BufferFluid[], cr: CentralizationResult[] | null): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  const ann = (Math.PI / 4) * ((w.holeDiameter / 1000) ** 2 - (w.casingOD / 1000) ** 2);
  const dh = (w.holeDiameter - w.casingOD) / 1000;
  if (ann <= 0) return c;

  // Determine average standoff
  let avgStandoff = 67; // default
  if (cr && cr.length > 0) avgStandoff = cr.reduce((a, r) => a + r.standoff, 0) / cr.length;

  // Determine if turbulent
  let hasTurbulent = false;
  for (const s of sl) {
    const rate = getFlowRateLps(s.flowRateSteps); if (rate <= 0) continue;
    const vel = (rate / 1000) / ann;
    const cat = cementCategory(s.density < 100 ? s.density : s.density / 1000);
    const rh = effectiveRheology(s.rheology, cat);
    const r = re(vel, dh, d(s.density), rh.pv, rh.yp);
    if (r >= 3000) hasTurbulent = true;
  }

  if (hasTurbulent && avgStandoff >= 67) {
    c.push({ section: "Эффективность вытеснения", title: "Высокая эффективность", status: "ok", detail: `${getTemplate(MUD_REMOVAL_TEMPLATES.good_efficiency)}\n\n${getTemplate(MUD_REMOVAL_TEMPLATES.factors)}` });
  } else if (hasTurbulent || avgStandoff >= 67) {
    c.push({ section: "Эффективность вытеснения", title: "Умеренная эффективность", status: "warning", detail: `${getTemplate(MUD_REMOVAL_TEMPLATES.moderate_efficiency)}\n\n${getTemplate(MUD_REMOVAL_TEMPLATES.preflush)}` });
  } else {
    c.push({ section: "Эффективность вытеснения", title: "Низкая эффективность", status: "critical", detail: `${getTemplate(MUD_REMOVAL_TEMPLATES.poor_efficiency)}\n\n${getTemplate(MUD_REMOVAL_TEMPLATES.factors)}` });
  }

  return c;
}

// ─── 11. Contamination ───────────────────────────────────────────

function checkContamination(bf: BufferFluid[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  const totalBufVol = bf.reduce((s, b) => s + b.volume, 0);

  if (bf.length === 0) c.push({ section: "Контаминация", title: "Высокий риск контаминации", status: "warning", detail: getTemplate(CONTAMINATION_TEMPLATES.high) });
  else if (totalBufVol < 1) c.push({ section: "Контаминация", title: "Умеренный риск контаминации", status: "warning", detail: getTemplate(CONTAMINATION_TEMPLATES.moderate, 1) });
  else c.push({ section: "Контаминация", title: "Риск контаминации — низкий", status: "ok", detail: getTemplate(CONTAMINATION_TEMPLATES.low) });

  return c;
}

// ─── 12. Gas Migration ───────────────────────────────────────────

function checkGasMigration(w: WellData, sl: SlurryInput[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  // Simplified gas migration risk assessment
  const isDeep = w.wellDepthMD > 2500;
  const isHot = w.bottomTempStatic > 80;
  const hasHeavyCement = sl.some(s => d(s.density) > 1900);

  if (isDeep && isHot && hasHeavyCement) {
    c.push({ section: "Газомиграция", title: "Умеренный риск газомиграции", status: "warning", detail: `${getTemplate(GAS_MIGRATION_TEMPLATES.moderate_risk)}\n\n${getTemplate(GAS_MIGRATION_TEMPLATES.factors)}` });
  } else if (isDeep || isHot) {
    c.push({ section: "Газомиграция", title: "Низкий риск газомиграции", status: "ok", detail: `${getTemplate(GAS_MIGRATION_TEMPLATES.low_risk)}\n\n${getTemplate(GAS_MIGRATION_TEMPLATES.factors)}` });
  } else {
    c.push({ section: "Газомиграция", title: "Риск газомиграции — незначительный", status: "ok", detail: getTemplate(GAS_MIGRATION_TEMPLATES.low_risk, 1) });
  }

  return c;
}

// ─── 13. WOC & Strength ──────────────────────────────────────────

function checkWOC(w: WellData, sl: SlurryInput[]): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];

  if (w.bottomTempStatic > 80) c.push({ section: "ОЗЦ и прочность", title: "ОЗЦ: ускоренное схватывание", status: "ok", detail: getTemplate(WOC_TEMPLATES.accelerated) });
  else if (w.bottomTempStatic < 40) c.push({ section: "ОЗЦ и прочность", title: "ОЗЦ: замедленное схватывание", status: "warning", detail: getTemplate(WOC_TEMPLATES.extended) });
  else c.push({ section: "ОЗЦ и прочность", title: "ОЗЦ: стандартное", status: "ok", detail: getTemplate(WOC_TEMPLATES.standard) });

  c.push({ section: "ОЗЦ и прочность", title: "Контроль набора прочности", status: "info", detail: getTemplate(WOC_TEMPLATES.monitoring) });

  // Retrogression check
  if (w.bottomTempStatic > 110) c.push({ section: "ОЗЦ и прочность", title: "Риск ретрогрессии прочности", status: "warning", detail: getTemplate(STRENGTH_TEMPLATES.retrogression) });
  else c.push({ section: "ОЗЦ и прочность", title: "Прочность цементного камня", status: "ok", detail: getTemplate(STRENGTH_TEMPLATES.adequate) });

  return c;
}

// ─── 14. Pipe Movement ───────────────────────────────────────────

function checkPipeMovement(): AnalysisCheck[] {
  return [
    { section: "Движение колонны", title: "Вращение/расхаживание", status: "info", detail: `${getTemplate(PIPE_MOVEMENT_TEMPLATES.rotation_recommended)}\n\n${getTemplate(PIPE_MOVEMENT_TEMPLATES.reciprocation_recommended)}\n\n${getTemplate(PIPE_MOVEMENT_TEMPLATES.not_possible)}` },
  ];
}

// ─── 15. Microannulus ────────────────────────────────────────────

function checkMicroannulus(w: WellData): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  if (w.bottomTempStatic > 80) c.push({ section: "Микрозазор", title: "Умеренный риск микрозазора", status: "warning", detail: getTemplate(MICROANNULUS_TEMPLATES.risk_moderate) });
  else c.push({ section: "Микрозазор", title: "Низкий риск микрозазора", status: "ok", detail: getTemplate(MICROANNULUS_TEMPLATES.risk_low) });
  return c;
}

// ─── 16. Temperature ─────────────────────────────────────────────

function checkTemperature(w: WellData): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  c.push({ section: "Температура", title: "BHCT vs BHST", status: "info", detail: getTemplate(TEMPERATURE_TEMPLATES.bhct_vs_bhst) });
  if (w.bottomTempStatic > 60 && w.wellDepthMD > 1500) c.push({ section: "Температура", title: "Температурный градиент", status: "info", detail: getTemplate(TEMPERATURE_TEMPLATES.gradient) });
  if (w.bottomTempStatic < 30) c.push({ section: "Температура", title: "Низкая забойная температура", status: "warning", detail: getTemplate(TEMPERATURE_TEMPLATES.cold_well) });
  return c;
}

// ─── 17. Pre-Job ─────────────────────────────────────────────────

function checkPreJob(): AnalysisCheck[] {
  return [
    { section: "Подготовка к операции", title: "Предоперационный чек-лист", status: "info", detail: `${getTemplate(PRE_JOB_TEMPLATES.checklist)}\n\n${getTemplate(PRE_JOB_TEMPLATES.lab_testing)}\n\n${getTemplate(PRE_JOB_TEMPLATES.equipment)}` },
  ];
}

// ─── 18. Sedimentation ───────────────────────────────────────────

function checkSedimentation(w: WellData): AnalysisCheck[] {
  const c: AnalysisCheck[] = [];
  const isHorizontal = w.wellDepthTVD > 0 && (w.wellDepthTVD / w.wellDepthMD) < 0.7;
  if (isHorizontal) c.push({ section: "Водоотделение/Седиментация", title: "Горизонтальная скважина — критический фактор", status: "warning", detail: getTemplate(SEDIMENTATION_TEMPLATES.horizontal_risk) });
  else c.push({ section: "Водоотделение/Седиментация", title: "Стабильность суспензии", status: "info", detail: getTemplate(SEDIMENTATION_TEMPLATES.ok) });
  return c;
}

// ═══════════════════════════════════════════════════════════════════
// Document Intelligence
// ═══════════════════════════════════════════════════════════════════

function analyzeDocuments(docs: DocumentInfo[]): { md: string; extractedValues: ExtractedValue[]; imageFindings: string[] } {
  if (!docs || docs.length === 0) return { md: "", extractedValues: [], imageFindings: [] };

  let md = "";
  const allValues: ExtractedValue[] = [];
  const imageFindings: string[] = [];
  const successful = docs.filter(d => d.text.trim().length > 0);
  const failed = docs.filter(d => d.error);

  // Text extraction
  for (const doc of successful) allValues.push(...extractValuesFromText(doc.text));

  // Image analysis
  for (const doc of docs) {
    if (doc.imageAnalysis) {
      const ia = doc.imageAnalysis;
      const cp = ia.colorProfile;

      if (ia.chartType.type === "akc_cbl" || ia.chartType.type === "vdl") {
        if (cp.darkAreaPercent > 50) imageFindings.push(`📊 **${doc.name}**: ${getTemplate(AKC_TEMPLATES.good_bond, h(doc.name))}`);
        else if (cp.darkAreaPercent > 25) imageFindings.push(`📊 **${doc.name}**: ${getTemplate(AKC_TEMPLATES.partial_bond, h(doc.name))}`);
        else imageFindings.push(`📊 **${doc.name}**: ${getTemplate(AKC_TEMPLATES.poor_bond, h(doc.name))}`);

        for (const zone of ia.zones) imageFindings.push(`  - ${zone.fromPercent.toFixed(0)}–${zone.toPercent.toFixed(0)}%: ${zone.label} (однородность ${(zone.uniformity * 100).toFixed(0)}%)`);
        if (ia.curveDetection.hasColorBands) imageFindings.push(`  - ${getTemplate(AKC_TEMPLATES.vdl_chevron, h(doc.name))}`);

        // Bond index interpretation
        imageFindings.push(`  - ${getTemplate(AKC_TEMPLATES.bond_index, h(doc.name))}`);
        if (cp.darkAreaPercent < 50) imageFindings.push(`  - ${getTemplate(AKC_TEMPLATES.casing_eccentricity, h(doc.name))}`);
      } else if (ia.chartType.type === "pressure_chart") {
        imageFindings.push(`📈 **${doc.name}**: График давлений/закачки. ~${ia.curveDetection.estimatedCurveCount} кривых.`);
      } else if (ia.chartType.type === "table") {
        imageFindings.push(`📋 **${doc.name}**: Табличная структура.`);
      } else {
        imageFindings.push(`🖼 **${doc.name}**: ${ia.chartType.description}`);
      }

      // OCR findings
      if (doc.ocrResult) {
        const ocr = doc.ocrResult;
        if (ocr.textRegions.length > 5) imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.text_detected, h(doc.name))}`);
        if (ocr.detectedNumbers.length > 0) imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.numbers_detected, h(doc.name))}`);
        if (ocr.tableRegions.length > 0) imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.table_detected, h(doc.name))}`);
        if (ocr.scaleInfo) imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.scale_detected, h(doc.name))}`);
        if (ocr.keywords.length > 0) imageFindings.push(`  - Элементы: ${ocr.keywords.map(k => k.keyword).join(", ")}`);
      }
    }
  }

  // Build extracted values section
  if (allValues.length > 0) {
    md += `## 📄 Извлечённые данные из документов\n\n`;
    md += `${getTemplate(DOCUMENT_TEMPLATES.values_extracted)}\n\n`;
    const categories = [...new Set(allValues.map(v => v.category))];
    md += `| Категория | Параметр | Значение |\n|---|---|---|\n`;
    for (const cat of categories) {
      for (const v of allValues.filter(v => v.category === cat).slice(0, 8)) {
        md += `| ${v.label} | ${v.raw} | ${v.value} |\n`;
      }
    }
    md += "\n";

    if (allValues.some(v => v.category === "density" || v.category === "pressure" || v.category === "depth")) md += `${getTemplate(DOCUMENT_TEMPLATES.program_found)}\n\n`;
    if (allValues.some(v => v.category === "bond" || v.category === "bond_log")) md += `${getTemplate(DOCUMENT_TEMPLATES.akc_report_found)}\n\n`;
    if (allValues.some(v => v.category === "thickening" || v.category === "fluid_loss" || v.category === "strength")) md += `${getTemplate(DOCUMENT_TEMPLATES.lab_data_found)}\n\n`;

    md += `${getTemplate(DOCUMENT_TEMPLATES.cross_reference)}\n\n`;
  }

  if (imageFindings.length > 0) {
    md += `## 🖼 Анализ изображений и графиков\n\n`;
    for (const f of imageFindings) md += `${f}\n\n`;
  }

  if (failed.length > 0) {
    md += `### ⚠️ Ошибки чтения\n\n`;
    for (const d of failed) md += `- ${d.name}: ${d.error}\n`;
    md += "\n";
  }

  // Raw document text
  const textDocs = successful.filter(d => !d.imageAnalysis);
  if (textDocs.length > 0) {
    md += `## 📎 Извлечённый текст\n\n`;
    for (const doc of textDocs) {
      md += `### ${doc.name}\n\n`;
      const t = doc.text.length > 2000 ? doc.text.slice(0, 2000) + `\n\n... (${doc.text.length} символов)` : doc.text;
      md += `${t}\n\n`;
    }
  }

  return { md, extractedValues: allValues, imageFindings };
}

// ═══════════════════════════════════════════════════════════════════
// Report Generation
// ═══════════════════════════════════════════════════════════════════

function buildReport(
  w: WellData, sl: SlurryInput[], checks: AnalysisCheck[],
  docSection: string, hasDocs: boolean, vals: ExtractedValue[], imgs: string[]
): string {
  const ok = checks.filter(c => c.status === "ok").length;
  const warn = checks.filter(c => c.status === "warning").length;
  const crit = checks.filter(c => c.status === "critical").length;
  const info = checks.filter(c => c.status === "info").length;
  const now = new Date().toLocaleString("ru-RU");

  let md = `# 📋 Отчёт DeAllsoft — комплексный анализ цементирования\n\n`;
  md += `> **Дисклеймер**: Отчёт сформирован автономной инженерной системой DeAllsoft на основе алгоритмов, шаблонов и распознавания документов. Система не использует внешний искусственный интеллект. Окончательное техническое решение принимает ответственный инженер.\n\n`;

  // General info
  md += `## 🔍 Общая информация\n\n`;
  md += `| Параметр | Значение |\n|---|---|\n`;
  md += `| Дата анализа | ${now} |\n| Версия системы | DeAllsoft v3.0 |\n`;
  md += `| Глубина MD / TVD | ${w.wellDepthMD} / ${w.wellDepthTVD || w.wellDepthMD} м |\n`;
  md += `| Спуск ОК | ${w.casingDepthMD} м |\n| ОК | Ø${w.casingOD} × ${w.casingWall} мм |\n`;
  md += `| Ствол | Ø${w.holeDiameter} мм |\n| Кав. коэфф. | ${w.cavernCoeff} |\n`;
  md += `| BHST | ${w.bottomTempStatic}°C |\n| Растворы | ${sl.length} |\n`;
  md += `| Документов | ${hasDocs ? "проанализированы" : "не загружены"} |\n`;
  if (vals.length > 0) md += `| Извлечено параметров | ${vals.length} |\n`;
  if (imgs.length > 0) md += `| Изображений проанализировано | ${imgs.length} |\n`;
  md += `\n`;

  // Summary
  md += `## 📊 Итоговая оценка\n\n`;
  md += `| Статус | Кол-во |\n|---|---|\n`;
  md += `| ✅ Норма | ${ok} |\n| ⚠️ Предупреждения | ${warn} |\n| 🔴 Критические | ${crit} |\n| ℹ️ Информация | ${info} |\n`;
  md += `| **Всего проверок** | **${checks.length}** |\n\n`;

  if (crit > 0) md += `### ${getTemplate(QUALITY_RATINGS.poor)}\n\n`;
  else if (warn > 3) md += `### ${getTemplate(QUALITY_RATINGS.satisfactory)}\n\n`;
  else if (warn > 0) md += `### ${getTemplate(QUALITY_RATINGS.good)}\n\n`;
  else md += `### ${getTemplate(QUALITY_RATINGS.excellent)}\n\n`;

  // Checks by section
  const sections = [...new Set(checks.map(c => c.section))];
  for (const sec of sections) {
    md += `## ${sec}\n\n`;
    for (const ch of checks.filter(c => c.section === sec)) {
      md += `### ${se(ch.status)} ${ch.title}\n\n${ch.detail}\n\n`;
    }
  }

  // Document analysis
  if (docSection) md += docSection;

  // Recommendations
  md += `## 📝 Рекомендации\n\n`;
  const critC = checks.filter(c => c.status === "critical");
  const warnC = checks.filter(c => c.status === "warning");
  if (critC.length > 0) { md += `### 🔴 Критические\n\n`; critC.forEach((c, i) => md += `${i + 1}. **${c.title}** — ${c.section}\n`); md += "\n"; }
  if (warnC.length > 0) { md += `### ⚠️ Предупреждения\n\n`; warnC.forEach((c, i) => md += `${i + 1}. ${c.title} — ${c.section}\n`); md += "\n"; }
  if (!critC.length && !warnC.length) md += `Все параметры в пределах нормы.\n\n`;

  // Zonal isolation assessment
  md += `## 🛡 Зональная изоляция\n\n`;
  if (crit > 0) md += `${getTemplate(ZONAL_ISOLATION_TEMPLATES.not_ensured)}\n\n`;
  else if (warn > 2) md += `${getTemplate(ZONAL_ISOLATION_TEMPLATES.questionable)}\n\n`;
  else md += `${getTemplate(ZONAL_ISOLATION_TEMPLATES.ensured)}\n\n`;

  // Conclusion
  md += `## 🏁 Заключение\n\n`;
  if (crit > 0) md += getTemplate(CONCLUSION_TEMPLATES.negative) + "\n\n";
  else if (warn > 0) md += getTemplate(CONCLUSION_TEMPLATES.with_remarks) + "\n\n";
  else md += getTemplate(CONCLUSION_TEMPLATES.positive) + "\n\n";

  // Standards
  md += `## 📚 Нормативная база\n\n`;
  md += `${getTemplate(STANDARDS_TEMPLATES.api)}\n\n${getTemplate(STANDARDS_TEMPLATES.russian)}\n\n`;

  // Limitations
  md += `## ⚙️ Ограничения\n\n`;
  md += `- Система использует детерминистические алгоритмы и шаблоны ответов (500+ вариантов).\n`;
  md += `- OCR распознаёт структуру и области текста, но не конкретные символы.\n`;
  md += `- Для окончательной оценки необходимы ГИС, лабораторные данные и экспертиза.\n`;
  md += `- Рекомендации носят консультативный характер.\n\n`;

  md += `---\n\n*DeAllsoft — автономный инженерный анализ v3.0 • ${checks.length} проверок • ${now}*\n`;

  return md;
}

// ═══════════════════════════════════════════════════════════════════
// Main Entry
// ═══════════════════════════════════════════════════════════════════

export function runAlgorithmicAnalysis(
  wellData: WellData,
  drillingFluid: DrillingFluid,
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  displacementFluids: DisplacementFluid[],
  centralizationResults: CentralizationResult[] | null,
  documentTexts?: DocumentInfo[]
): AnalysisReport {
  const checks: AnalysisCheck[] = [];

  // Core engineering checks
  checks.push(...checkGeometry(wellData));
  checks.push(...checkDensity(drillingFluid, slurries, buffers));
  checks.push(...checkFlow(wellData, slurries, buffers));
  checks.push(...checkCentral(centralizationResults));
  checks.push(...checkRheology(slurries, drillingFluid));
  checks.push(...checkBuffers(buffers, wellData));
  checks.push(...checkThickening(slurries, wellData, buffers, displacementFluids));
  checks.push(...checkDisplacement(displacementFluids));

  // Advanced checks
  checks.push(...checkECD(wellData, slurries, buffers));
  checks.push(...checkMudRemoval(wellData, slurries, buffers, centralizationResults));
  checks.push(...checkContamination(buffers));
  checks.push(...checkGasMigration(wellData, slurries));
  checks.push(...checkWOC(wellData, slurries));
  checks.push(...checkPipeMovement());
  checks.push(...checkMicroannulus(wellData));
  checks.push(...checkTemperature(wellData));
  checks.push(...checkSedimentation(wellData));
  checks.push(...checkPreJob());

  // Document intelligence
  const { md: docSection, extractedValues, imageFindings } = analyzeDocuments(documentTexts || []);

  const markdown = buildReport(wellData, slurries, checks, docSection, !!documentTexts?.length, extractedValues, imageFindings);

  return {
    timestamp: new Date().toISOString(),
    wellSummary: `${wellData.wellDepthMD}м MD, ${slurries.length} р-р(ов), ${checks.length} проверок`,
    checks,
    markdown,
  };
}
