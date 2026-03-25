/**
 * Алгоритмический анализ качества цементирования
 * Без использования AI — чистая инженерная логика + шаблоны ответов
 * Версия 2.0 — с распознаванием документов и AI-подобными отчётами
 */

import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "./cementing-calculations";
import { effectiveRheology, cementCategory, getCasingID, getSlurryHeight, getFlowRateLps } from "./cementing-calculations";
import type { CentralizationResult } from "./centralization-calculations";
import {
  QUALITY_RATINGS, DENSITY_TEMPLATES, FLOW_REGIME_TEMPLATES,
  CENTRALIZATION_TEMPLATES, THICKENING_TIME_TEMPLATES, RHEOLOGY_TEMPLATES,
  BUFFER_TEMPLATES, AKC_TEMPLATES, GEOMETRY_TEMPLATES, DISPLACEMENT_TEMPLATES,
  CONCLUSION_TEMPLATES, IMAGE_INTERPRETATION_TEMPLATES, DOCUMENT_TEMPLATES,
  getTemplate, extractValuesFromText, type ExtractedValue
} from "./analysis-templates";
import type { ImageAnalysisResult } from "./image-analysis-engine";
import type { OcrResult } from "./ocr-engine";

interface AnalysisCheck {
  section: string;
  title: string;
  status: "ok" | "warning" | "critical";
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

function densityKgM3(d: number): number {
  return d < 100 ? d * 1000 : d;
}

function statusEmoji(s: "ok" | "warning" | "critical"): string {
  return s === "ok" ? "✅" : s === "warning" ? "⚠️" : "🔴";
}

function reynoldsNumber(velocity: number, hydraulicDia: number, density: number, pv: number, yp: number): number {
  if (pv <= 0) return 0;
  const pvPas = pv / 1000;
  const effectiveVisc = pvPas + yp * hydraulicDia / (6 * Math.max(velocity, 0.001));
  if (effectiveVisc <= 0) return 0;
  return (density * velocity * hydraulicDia) / effectiveVisc;
}

function flowRegimeLabel(re: number): string {
  if (re < 2100) return "ламинарный";
  if (re < 3000) return "переходный";
  return "турбулентный";
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ─── Analysis checks (same logic, template-enriched details) ─────

function checkDensityHierarchy(
  drillingFluid: DrillingFluid, slurries: SlurryInput[], buffers: BufferFluid[], _displacementFluids: DisplacementFluid[]
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  const mudDensity = densityKgM3(drillingFluid.density);

  for (const buf of buffers) {
    const bufD = densityKgM3(buf.density);
    if (bufD < mudDensity * 0.95) {
      checks.push({
        section: "Плотности", title: `Буфер "${buf.name}" легче бурового раствора`, status: "warning",
        detail: `${getTemplate(DENSITY_TEMPLATES.buffer_light, hashCode(buf.name))}\n\nБуфер: ${bufD.toFixed(0)} кг/м³, бур. р-р: ${mudDensity.toFixed(0)} кг/м³. Разница: ${(mudDensity - bufD).toFixed(0)} кг/м³.`,
      });
    }
  }

  for (const sl of slurries) {
    const slD = densityKgM3(sl.density);
    if (slD < mudDensity) {
      checks.push({
        section: "Плотности", title: `Цемент "${sl.name}" легче бурового раствора`, status: "critical",
        detail: `${getTemplate(DENSITY_TEMPLATES.cement_light, hashCode(sl.name))}\n\nЦемент: ${slD.toFixed(0)} кг/м³, бур. р-р: ${mudDensity.toFixed(0)} кг/м³.`,
      });
    }
  }

  for (let i = 0; i < slurries.length - 1; i++) {
    const upper = densityKgM3(slurries[i].density);
    const lower = densityKgM3(slurries[i + 1].density);
    if (upper > lower * 1.05) {
      checks.push({
        section: "Плотности", title: "Нарушение иерархии между растворами", status: "warning",
        detail: `${getTemplate(DENSITY_TEMPLATES.hierarchy_warning, i)}\n\n"${slurries[i].name}" (${upper.toFixed(0)}) плотнее "${slurries[i + 1].name}" (${lower.toFixed(0)} кг/м³).`,
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      section: "Плотности", title: "Иерархия плотностей корректна", status: "ok",
      detail: `${getTemplate(DENSITY_TEMPLATES.hierarchy_ok)}\n\nБур. р-р: ${mudDensity.toFixed(0)} кг/м³ → ${buffers.length > 0 ? `Буферы (${buffers.map(b => densityKgM3(b.density).toFixed(0)).join(", ")}) → ` : ""}Цемент (${slurries.map(s => densityKgM3(s.density).toFixed(0)).join(", ")}) кг/м³.`,
    });
  }

  return checks;
}

function checkFlowRegimes(wellData: WellData, _df: DrillingFluid, slurries: SlurryInput[], buffers: BufferFluid[]): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  const annGap = (wellData.holeDiameter - wellData.casingOD) / 1000;
  const hydraulicDia = annGap > 0 ? annGap : 0.05;
  const annArea = (Math.PI / 4) * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);
  if (annArea <= 0) return checks;

  for (const sl of slurries) {
    const rate = getFlowRateLps(sl.flowRateSteps);
    if (rate <= 0) continue;
    const velocity = (rate / 1000) / annArea;
    const dens = densityKgM3(sl.density);
    const cat = cementCategory(sl.density < 100 ? sl.density : sl.density / 1000);
    const rh = effectiveRheology(sl.rheology, cat);
    const re = reynoldsNumber(velocity, hydraulicDia, dens, rh.pv, rh.yp);

    if (re >= 3000) {
      checks.push({
        section: "Режимы течения", title: `${sl.name}: турбулентный (Re=${re.toFixed(0)})`, status: "ok",
        detail: `${getTemplate(FLOW_REGIME_TEMPLATES.turbulent_good, hashCode(sl.name))}\n\nРасход: ${rate.toFixed(1)} л/с, скорость: ${velocity.toFixed(2)} м/с, Re = ${re.toFixed(0)}.`,
      });
    } else if (re < 2100) {
      checks.push({
        section: "Режимы течения", title: `${sl.name}: ламинарный (Re=${re.toFixed(0)})`, status: "warning",
        detail: `${getTemplate(FLOW_REGIME_TEMPLATES.laminar_risk, hashCode(sl.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.recommendation_rate, hashCode(sl.name) + 1)}\n\nРасход: ${rate.toFixed(1)} л/с, Re = ${re.toFixed(0)}.`,
      });
    } else {
      checks.push({
        section: "Режимы течения", title: `${sl.name}: переходный (Re=${re.toFixed(0)})`, status: "warning",
        detail: `${getTemplate(FLOW_REGIME_TEMPLATES.transitional, hashCode(sl.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.recommendation_turbulizers, hashCode(sl.name) + 1)}`,
      });
    }
  }

  for (const buf of buffers) {
    const rate = getFlowRateLps(buf.flowRateSteps);
    if (rate <= 0) continue;
    const velocity = (rate / 1000) / annArea;
    const dens = densityKgM3(buf.density);
    const rh = effectiveRheology(buf.rheology, "buffer");
    const re = reynoldsNumber(velocity, hydraulicDia, dens, rh.pv, rh.yp);

    checks.push({
      section: "Режимы течения",
      title: `Буфер "${buf.name}": ${flowRegimeLabel(re)} (Re=${re.toFixed(0)})`,
      status: re >= 3000 ? "ok" : "warning",
      detail: re >= 3000
        ? `${getTemplate(FLOW_REGIME_TEMPLATES.turbulent_good, hashCode(buf.name))}`
        : `${getTemplate(FLOW_REGIME_TEMPLATES.laminar_risk, hashCode(buf.name))}\n\n${getTemplate(FLOW_REGIME_TEMPLATES.recommendation_rate, hashCode(buf.name))}`,
    });
  }

  return checks;
}

function checkCentralization(centralizationResults: CentralizationResult[] | null, _wellData: WellData): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  if (!centralizationResults || centralizationResults.length === 0) {
    checks.push({
      section: "Центрирование", title: "Данные центрирования отсутствуют", status: "warning",
      detail: "Расчёт центрирования не выполнен. Невозможно оценить standoff. Рекомендуется выполнить расчёт для полного анализа.",
    });
    return checks;
  }

  const standoffs = centralizationResults.map(r => r.standoff);
  const minStandoff = Math.min(...standoffs);
  const avgStandoff = standoffs.reduce((a, b) => a + b, 0) / standoffs.length;
  const belowTarget = centralizationResults.filter(r => r.standoff < 67);
  const critical = centralizationResults.filter(r => r.standoff < 50);

  if (minStandoff >= 67) {
    checks.push({
      section: "Центрирование", title: `Standoff ≥ 67% (мин. ${minStandoff.toFixed(1)}%)`, status: "ok",
      detail: `${getTemplate(CENTRALIZATION_TEMPLATES.good)}\n\nМинимальный standoff: ${minStandoff.toFixed(1)}%, средний: ${avgStandoff.toFixed(1)}%.`,
    });
  } else if (critical.length > 0) {
    const depths = critical.slice(0, 3).map(r => `${r.md.toFixed(0)}м (${r.standoff.toFixed(1)}%)`).join(", ");
    checks.push({
      section: "Центрирование", title: `Критический standoff < 50%`, status: "critical",
      detail: `${getTemplate(CENTRALIZATION_TEMPLATES.critical)}\n\n${getTemplate(CENTRALIZATION_TEMPLATES.angle_correlation)}\n\n${critical.length} точек: ${depths}.`,
    });
  } else {
    const depths = belowTarget.slice(0, 3).map(r => `${r.md.toFixed(0)}м (${r.standoff.toFixed(1)}%)`).join(", ");
    checks.push({
      section: "Центрирование", title: `Standoff ниже 67% в ${belowTarget.length} точках`, status: "warning",
      detail: `${getTemplate(CENTRALIZATION_TEMPLATES.warning)}\n\n${depths}.`,
    });
  }

  return checks;
}

function checkThickeningTime(slurries: SlurryInput[], wellData: WellData, buffers: BufferFluid[], displacementFluids: DisplacementFluid[]): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const annArea = (Math.PI / 4) * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);
  const pipeArea = (Math.PI / 4) * (casingID / 1000) ** 2;

  for (const sl of slurries) {
    if (sl.thickeningTime50Bc <= 0) {
      checks.push({ section: "Время загустевания", title: `${sl.name}: не задано`, status: "warning", detail: `Для раствора "${sl.name}" не указано время загустевания. Невозможно оценить безопасность.` });
      continue;
    }

    const height = getSlurryHeight([sl], 0, wellData.casingDepthMD);
    const rate = getFlowRateLps(sl.flowRateSteps);
    const rateM3min = rate > 0 ? (rate / 1000) * 60 : 0.01;
    const annVolM3 = annArea * height;
    const cementPumpTime = rateM3min > 0 ? annVolM3 / rateM3min : 0;

    let dispRate = 0;
    for (const df of displacementFluids) { const r = getFlowRateLps(df.flowRateSteps); if (r > dispRate) dispRate = r; }
    const dispRateM3min = dispRate > 0 ? (dispRate / 1000) * 60 : rateM3min;
    const dispTime = dispRateM3min > 0 ? (pipeArea * wellData.casingDepthMD) / dispRateM3min : 0;

    let bufTime = 0;
    for (const buf of buffers) {
      const br = getFlowRateLps(buf.flowRateSteps);
      const brM3min = br > 0 ? (br / 1000) * 60 : rateM3min;
      bufTime += brM3min > 0 ? buf.volume / brM3min : 0;
    }

    const totalWorkTime = bufTime + cementPumpTime + dispTime + 15;
    const safeTime = sl.thickeningTime50Bc * 0.75;

    if (totalWorkTime > safeTime) {
      checks.push({
        section: "Время загустевания", title: `${sl.name}: превышен лимит!`, status: "critical",
        detail: `${getTemplate(THICKENING_TIME_TEMPLATES.critical)}\n\nРасчётное время: ~${totalWorkTime.toFixed(0)} мин. Безопасное: ${safeTime.toFixed(0)} мин (75% от ${sl.thickeningTime50Bc}).`,
      });
    } else {
      const margin = safeTime - totalWorkTime;
      checks.push({
        section: "Время загустевания", title: `${sl.name}: запас ${margin.toFixed(0)} мин`, status: margin > 30 ? "ok" : "warning",
        detail: `${getTemplate(margin > 30 ? THICKENING_TIME_TEMPLATES.safe : THICKENING_TIME_TEMPLATES.marginal)}\n\nВремя операции: ~${totalWorkTime.toFixed(0)} мин, безопасное: ${safeTime.toFixed(0)} мин. Запас: ${margin.toFixed(0)} мин.`,
      });
    }
  }

  return checks;
}

function checkRheology(slurries: SlurryInput[], drillingFluid: DrillingFluid, _buffers: BufferFluid[]): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  for (const sl of slurries) {
    if (sl.rheology.pv === 0 && sl.rheology.yp === 0) {
      checks.push({ section: "Реология", title: `${sl.name}: значения по умолчанию`, status: "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.default_values) });
    }
    const cat = cementCategory(sl.density < 100 ? sl.density : sl.density / 1000);
    const rh = effectiveRheology(sl.rheology, cat);
    if (rh.yp > 15) {
      checks.push({ section: "Реология", title: `${sl.name}: высокое ДНС (YP=${rh.yp} Па)`, status: "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.high_yp) });
    }
  }

  if (drillingFluid.rheology.pv === 0 && drillingFluid.rheology.yp === 0) {
    checks.push({ section: "Реология", title: "Реология бур. р-ра по умолчанию", status: "warning", detail: getTemplate(RHEOLOGY_TEMPLATES.default_values, 1) });
  }

  if (drillingFluid.fluidLoss > 10) {
    checks.push({
      section: "Реология", title: `Водоотдача: ${drillingFluid.fluidLoss} мл/30мин`, status: drillingFluid.fluidLoss > 15 ? "critical" : "warning",
      detail: getTemplate(RHEOLOGY_TEMPLATES.water_loss_high, Math.round(drillingFluid.fluidLoss)),
    });
  }

  // Always recommend compatibility test
  if (slurries.length > 0) {
    checks.push({ section: "Реология", title: "Совместимость жидкостей", status: "ok", detail: getTemplate(RHEOLOGY_TEMPLATES.compatibility) });
  }

  return checks;
}

function checkBuffers(buffers: BufferFluid[], wellData: WellData): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  if (buffers.length === 0) {
    checks.push({ section: "Буферные жидкости", title: "Буферы отсутствуют", status: "warning", detail: getTemplate(BUFFER_TEMPLATES.missing) });
    return checks;
  }

  const annArea = (Math.PI / 4) * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);
  for (const buf of buffers) {
    if (annArea > 0 && buf.volume > 0) {
      const bufHeight = buf.volume / annArea;
      const rate = getFlowRateLps(buf.flowRateSteps);
      if (rate > 0) {
        const velocity = (rate / 1000) / annArea;
        const contactTime = velocity > 0 ? bufHeight / velocity : 0;
        if (contactTime < 600) {
          checks.push({
            section: "Буферные жидкости", title: `"${buf.name}": контакт ${(contactTime / 60).toFixed(1)} мин`, status: contactTime < 300 ? "critical" : "warning",
            detail: `${getTemplate(BUFFER_TEMPLATES.short_contact, hashCode(buf.name))}\n\nФактическое время контакта: ${(contactTime / 60).toFixed(1)} мин.`,
          });
        } else {
          checks.push({
            section: "Буферные жидкости", title: `"${buf.name}": контакт ${(contactTime / 60).toFixed(1)} мин`, status: "ok",
            detail: getTemplate(BUFFER_TEMPLATES.adequate, hashCode(buf.name)),
          });
        }
      }
    }
  }

  if (buffers.length === 1) {
    checks.push({ section: "Буферные жидкости", title: "Одна ступень буфера", status: "ok", detail: getTemplate(BUFFER_TEMPLATES.two_stage) });
  }

  return checks;
}

function checkWellGeometry(wellData: WellData): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  if (wellData.wellDepthMD <= 0) {
    checks.push({ section: "Скважина", title: "Глубина не задана", status: "critical", detail: "Необходимо задать глубину скважины." });
    return checks;
  }

  const clearance = wellData.holeDiameter - wellData.casingOD;
  if (clearance < 20) {
    checks.push({ section: "Скважина", title: `Малый зазор: ${clearance.toFixed(0)} мм`, status: "critical", detail: getTemplate(GEOMETRY_TEMPLATES.tight_annulus) });
  } else if (clearance < 30) {
    checks.push({ section: "Скважина", title: `Зазор: ${clearance.toFixed(0)} мм`, status: "warning", detail: getTemplate(GEOMETRY_TEMPLATES.tight_annulus, 1) });
  }

  if (wellData.cavernCoeff > 1.3) {
    checks.push({ section: "Скважина", title: `Кавернозность: ${wellData.cavernCoeff.toFixed(2)}`, status: "warning", detail: getTemplate(GEOMETRY_TEMPLATES.cavern) });
  }

  if (wellData.bottomTempStatic > 100) {
    checks.push({ section: "Скважина", title: `BHST: ${wellData.bottomTempStatic}°C`, status: "warning", detail: getTemplate(GEOMETRY_TEMPLATES.high_temperature) });
  }

  if (wellData.wellDepthMD > 3000) {
    checks.push({ section: "Скважина", title: `Глубокая скважина: ${wellData.wellDepthMD} м`, status: "ok", detail: getTemplate(GEOMETRY_TEMPLATES.deep_well) });
  }

  return checks;
}

function checkDisplacement(displacementFluids: DisplacementFluid[]): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  if (displacementFluids.length === 0) {
    checks.push({ section: "Продавка", title: "Не задана", status: "warning", detail: "Параметры продавки не указаны." });
    return checks;
  }
  for (const df of displacementFluids) {
    if (df.compressionCoeff > 1.1) {
      checks.push({ section: "Продавка", title: `Коэфф. сжатия: ${df.compressionCoeff}`, status: "warning", detail: getTemplate(DISPLACEMENT_TEMPLATES.compression_high) });
    }
  }
  if (checks.length === 0) {
    checks.push({ section: "Продавка", title: "Продавка — OK", status: "ok", detail: getTemplate(DISPLACEMENT_TEMPLATES.ok) });
  }
  return checks;
}

// ─── Document Intelligence ───────────────────────────────────────

function analyzeDocumentContent(docs: DocumentInfo[]): { md: string; extractedValues: ExtractedValue[]; imageFindings: string[] } {
  if (!docs || docs.length === 0) return { md: "", extractedValues: [], imageFindings: [] };

  let md = "";
  const allValues: ExtractedValue[] = [];
  const imageFindings: string[] = [];
  const successful = docs.filter(d => d.text.trim().length > 0);
  const failed = docs.filter(d => d.error);

  // ── Text document analysis ──
  for (const doc of successful) {
    const values = extractValuesFromText(doc.text);
    allValues.push(...values);
  }

  // ── Image analysis with OCR ──
  for (const doc of docs) {
    if (doc.imageAnalysis) {
      const ia = doc.imageAnalysis;
      const cp = ia.colorProfile;

      // AKC/CBL interpretation
      if (ia.chartType.type === "akc_cbl" || ia.chartType.type === "vdl") {
        if (cp.darkAreaPercent > 50) {
          imageFindings.push(`📊 **${doc.name}**: ${getTemplate(AKC_TEMPLATES.good_bond, hashCode(doc.name))}`);
        } else if (cp.darkAreaPercent > 25) {
          imageFindings.push(`📊 **${doc.name}**: ${getTemplate(AKC_TEMPLATES.partial_bond, hashCode(doc.name))}`);
        } else {
          imageFindings.push(`📊 **${doc.name}**: ${getTemplate(AKC_TEMPLATES.poor_bond, hashCode(doc.name))}`);
        }

        // Zone details
        for (const zone of ia.zones) {
          imageFindings.push(`  - ${zone.fromPercent.toFixed(0)}–${zone.toPercent.toFixed(0)}% по глубине: ${zone.label} (однородность ${(zone.uniformity * 100).toFixed(0)}%)`);
        }

        if (ia.curveDetection.hasColorBands) {
          imageFindings.push(`  - ${getTemplate(AKC_TEMPLATES.vdl_chevron, hashCode(doc.name))}`);
        }
      } else if (ia.chartType.type === "pressure_chart") {
        imageFindings.push(`📈 **${doc.name}**: Обнаружен график давлений/закачки. ${ia.curveDetection.estimatedCurveCount} кривых, ${ia.curveDetection.hasGrid ? "координатная сетка присутствует" : "без координатной сетки"}.`);
      } else if (ia.chartType.type === "table") {
        imageFindings.push(`📋 **${doc.name}**: Обнаружена табличная структура.`);
      } else {
        imageFindings.push(`🖼 **${doc.name}**: ${ia.chartType.description}`);
      }

      // OCR findings
      if (doc.ocrResult) {
        const ocr = doc.ocrResult;
        if (ocr.textRegions.length > 5) {
          imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.text_detected, hashCode(doc.name))}`);
        }
        if (ocr.detectedNumbers.length > 0) {
          imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.numbers_detected, hashCode(doc.name))}`);
        }
        if (ocr.tableRegions.length > 0) {
          imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.table_detected, hashCode(doc.name))}`);
        }
        if (ocr.scaleInfo) {
          imageFindings.push(`  - ${getTemplate(IMAGE_INTERPRETATION_TEMPLATES.scale_detected, hashCode(doc.name))}`);
        }
        if (ocr.keywords.length > 0) {
          imageFindings.push(`  - Определены элементы: ${ocr.keywords.map(k => k.keyword).join(", ")}`);
        }
      }
    }
  }

  // ── Build extracted values section ──
  if (allValues.length > 0) {
    md += `## 📄 Извлечённые данные из документов\n\n`;
    md += `${getTemplate(DOCUMENT_TEMPLATES.values_extracted)}\n\n`;

    const categories = [...new Set(allValues.map(v => v.category))];
    md += `| Категория | Параметр | Значение |\n|---|---|---|\n`;
    for (const cat of categories) {
      const catValues = allValues.filter(v => v.category === cat).slice(0, 10);
      for (const v of catValues) {
        md += `| ${v.label} | ${v.raw} | ${v.value} |\n`;
      }
    }
    md += "\n";

    // Check for program data
    const hasDensity = allValues.some(v => v.category === "density");
    const hasPressure = allValues.some(v => v.category === "pressure");
    const hasDepth = allValues.some(v => v.category === "depth");

    if (hasDensity || hasPressure || hasDepth) {
      md += `${getTemplate(DOCUMENT_TEMPLATES.program_found)}\n\n`;
    }

    const hasBondLog = allValues.some(v => v.category === "bond" || v.category === "bond_log");
    if (hasBondLog) {
      md += `${getTemplate(DOCUMENT_TEMPLATES.akc_report_found)}\n\n`;
    }

    const hasLabData = allValues.some(v => v.category === "thickening" || v.category === "fluid_loss");
    if (hasLabData) {
      md += `${getTemplate(DOCUMENT_TEMPLATES.lab_data_found)}\n\n`;
    }
  }

  // ── Image findings section ──
  if (imageFindings.length > 0) {
    md += `## 🖼 Анализ изображений и графиков\n\n`;
    for (const finding of imageFindings) {
      md += `${finding}\n\n`;
    }
  }

  // ── Failed docs ──
  if (failed.length > 0) {
    md += `### ⚠️ Ошибки чтения\n\n`;
    for (const d of failed) {
      md += `- ${d.name}: ${d.error}\n`;
    }
    md += "\n";
  }

  // ── Raw document text (truncated) ──
  if (successful.length > 0) {
    md += `## 📎 Извлечённый текст документов\n\n`;
    for (const doc of successful) {
      // Skip image analysis text (already covered above)
      if (doc.imageAnalysis) continue;
      md += `### ${doc.name}\n\n`;
      const maxLen = 2000;
      const text = doc.text.length > maxLen
        ? doc.text.slice(0, maxLen) + `\n\n... (обрезано, всего ${doc.text.length} символов)`
        : doc.text;
      md += `${text}\n\n`;
    }
  }

  return { md, extractedValues: allValues, imageFindings };
}

// ─── Report Generation (AI-quality) ─────────────────────────────

function generateMarkdownReport(
  wellData: WellData,
  slurries: SlurryInput[],
  checks: AnalysisCheck[],
  docSection: string,
  hasDocuments: boolean,
  extractedValues: ExtractedValue[],
  imageFindings: string[]
): string {
  const stats = { ok: 0, warn: 0, crit: 0, total: checks.length };
  for (const c of checks) {
    if (c.status === "ok") stats.ok++;
    else if (c.status === "warning") stats.warn++;
    else stats.crit++;
  }
  const now = new Date().toLocaleString("ru-RU");

  let md = `# 📋 Отчёт DeAllsoft — анализ качества цементирования\n\n`;
  md += `> **Дисклеймер**: Данный отчёт сформирован автоматически на основе инженерных алгоритмов и распознавания документов. Окончательное техническое решение принимает ответственный инженер.\n\n`;

  // ── General info ──
  md += `## 🔍 Общая информация\n\n`;
  md += `| Параметр | Значение |\n|---|---|\n`;
  md += `| Дата анализа | ${now} |\n`;
  md += `| Глубина MD | ${wellData.wellDepthMD} м |\n`;
  md += `| Глубина TVD | ${wellData.wellDepthTVD || wellData.wellDepthMD} м |\n`;
  md += `| Спуск ОК | ${wellData.casingDepthMD} м |\n`;
  md += `| ОК | Ø${wellData.casingOD} × ${wellData.casingWall} мм |\n`;
  md += `| Ствол | Ø${wellData.holeDiameter} мм |\n`;
  md += `| Кол-во растворов | ${slurries.length} |\n`;
  md += `| BHST | ${wellData.bottomTempStatic}°C |\n`;
  md += `| Коэфф. кавернозности | ${wellData.cavernCoeff} |\n`;
  md += `| Документов проанализировано | ${hasDocuments ? "да" : "нет"} |\n`;
  if (extractedValues.length > 0) {
    md += `| Извлечено значений | ${extractedValues.length} |\n`;
  }
  if (imageFindings.length > 0) {
    md += `| Проанализировано изображений | ${imageFindings.length} |\n`;
  }
  md += `\n`;

  // ── Summary score ──
  md += `## 📊 Итоговая оценка\n\n`;
  md += `| Статус | Кол-во |\n|---|---|\n`;
  md += `| ✅ Норма | ${stats.ok} |\n`;
  md += `| ⚠️ Предупреждения | ${stats.warn} |\n`;
  md += `| 🔴 Критические | ${stats.crit} |\n`;
  md += `| **Всего проверок** | **${stats.total}** |\n\n`;

  // Overall quality rating
  if (stats.crit > 0) {
    md += `### ${getTemplate(QUALITY_RATINGS.poor)}\n\n`;
  } else if (stats.warn > 3) {
    md += `### ${getTemplate(QUALITY_RATINGS.satisfactory)}\n\n`;
  } else if (stats.warn > 0) {
    md += `### ${getTemplate(QUALITY_RATINGS.good)}\n\n`;
  } else {
    md += `### ${getTemplate(QUALITY_RATINGS.excellent)}\n\n`;
  }

  // ── Detailed checks by section ──
  const sections = [...new Set(checks.map(c => c.section))];
  for (const section of sections) {
    md += `## ${section}\n\n`;
    const sectionChecks = checks.filter(c => c.section === section);
    for (const check of sectionChecks) {
      md += `### ${statusEmoji(check.status)} ${check.title}\n\n`;
      md += `${check.detail}\n\n`;
    }
  }

  // ── Document analysis results ──
  if (docSection) {
    md += docSection;
  }

  // ── Recommendations ──
  md += `## 📝 Рекомендации\n\n`;

  const critChecks = checks.filter(c => c.status === "critical");
  const warnChecks = checks.filter(c => c.status === "warning");

  if (critChecks.length > 0) {
    md += `### 🔴 Критические (необходимо устранить)\n\n`;
    critChecks.forEach((c, i) => { md += `${i + 1}. **${c.title}** — ${c.section}\n`; });
    md += "\n";
  }

  if (warnChecks.length > 0) {
    md += `### ⚠️ Предупреждения (рекомендуется рассмотреть)\n\n`;
    warnChecks.forEach((c, i) => { md += `${i + 1}. ${c.title} — ${c.section}\n`; });
    md += "\n";
  }

  if (critChecks.length === 0 && warnChecks.length === 0) {
    md += `Все проверенные параметры в пределах нормы.\n\n`;
  }

  // ── Conclusion ──
  md += `## 🏁 Заключение\n\n`;
  if (stats.crit > 0) {
    md += getTemplate(CONCLUSION_TEMPLATES.negative) + "\n\n";
  } else if (stats.warn > 0) {
    md += getTemplate(CONCLUSION_TEMPLATES.with_remarks) + "\n\n";
  } else {
    md += getTemplate(CONCLUSION_TEMPLATES.positive) + "\n\n";
  }

  // Limitations
  md += `## ⚙️ Ограничения анализа\n\n`;
  md += `- Анализ основан на расчётных данных, введённых пользователем.\n`;
  md += `- Распознавание изображений выполняется алгоритмически (без нейросетей) — возможны неточности в интерпретации.\n`;
  md += `- OCR на изображениях определяет структуру и области текста, но не распознаёт конкретные символы.\n`;
  md += `- Для окончательной оценки необходимы данные ГИС, лабораторные результаты и профессиональная экспертиза.\n\n`;

  md += `---\n\n`;
  md += `*DeAllsoft — автономный инженерный анализ v2.0 • ${now}*\n`;

  return md;
}

// ─── Main entry point ────────────────────────────────────────────

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

  checks.push(...checkWellGeometry(wellData));
  checks.push(...checkDensityHierarchy(drillingFluid, slurries, buffers, displacementFluids));
  checks.push(...checkFlowRegimes(wellData, drillingFluid, slurries, buffers));
  checks.push(...checkCentralization(centralizationResults, wellData));
  checks.push(...checkRheology(slurries, drillingFluid, buffers));
  checks.push(...checkBuffers(buffers, wellData));
  checks.push(...checkThickeningTime(slurries, wellData, buffers, displacementFluids));
  checks.push(...checkDisplacement(displacementFluids));

  const { md: docSection, extractedValues, imageFindings } = analyzeDocumentContent(documentTexts || []);
  const hasDocuments = !!documentTexts && documentTexts.length > 0;

  const markdown = generateMarkdownReport(wellData, slurries, checks, docSection, hasDocuments, extractedValues, imageFindings);

  return {
    timestamp: new Date().toISOString(),
    wellSummary: `${wellData.wellDepthMD}м MD, ${slurries.length} р-р(ов)`,
    checks,
    markdown,
  };
}
