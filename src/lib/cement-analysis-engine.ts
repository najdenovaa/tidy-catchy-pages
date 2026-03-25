/**
 * Алгоритмический анализ качества цементирования
 * Без использования AI — чистая инженерная логика
 */

import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid, Rheology } from "./cementing-calculations";
import { effectiveRheology, cementCategory, getCasingID, getSlurryHeight, getFlowRateLps } from "./cementing-calculations";
import type { CentralizationResult } from "./centralization-calculations";

interface AnalysisCheck {
  section: string;
  title: string;
  status: "ok" | "warning" | "critical";
  detail: string;
}

interface AnalysisReport {
  timestamp: string;
  wellSummary: string;
  checks: AnalysisCheck[];
  markdown: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function densityKgM3(d: number): number {
  // Автоопределение: если < 100 — это г/см³
  return d < 100 ? d * 1000 : d;
}

function statusEmoji(s: "ok" | "warning" | "critical"): string {
  return s === "ok" ? "✅" : s === "warning" ? "⚠️" : "🔴";
}

function reynoldsNumber(
  velocity: number, // м/с
  hydraulicDia: number, // м
  density: number, // кг/м³
  pv: number, // сПз
  yp: number // Па
): number {
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

// ─── Analysis checks ─────────────────────────────────────────────

function checkDensityHierarchy(
  drillingFluid: DrillingFluid,
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  displacementFluids: DisplacementFluid[]
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  const mudDensity = densityKgM3(drillingFluid.density);

  // Check buffers vs mud
  for (const buf of buffers) {
    const bufD = densityKgM3(buf.density);
    if (bufD < mudDensity * 0.95) {
      checks.push({
        section: "Плотности",
        title: "Плотность буфера ниже бурового раствора",
        status: "warning",
        detail: `Буфер "${buf.name}" (${bufD.toFixed(0)} кг/м³) < Бур. р-р (${mudDensity.toFixed(0)} кг/м³). Риск каналообразования.`,
      });
    }
  }

  // Check cement vs mud — cement should be >= mud
  for (const sl of slurries) {
    const slD = densityKgM3(sl.density);
    if (slD < mudDensity) {
      checks.push({
        section: "Плотности",
        title: "Плотность цемента ниже бурового раствора",
        status: "critical",
        detail: `Раствор "${sl.name}" (${slD.toFixed(0)} кг/м³) < Бур. р-р (${mudDensity.toFixed(0)} кг/м³). Высокий риск контаминации и зависания.`,
      });
    }
  }

  // Check hierarchy between slurries (bottom should be denser or equal)
  for (let i = 0; i < slurries.length - 1; i++) {
    const upper = densityKgM3(slurries[i].density);
    const lower = densityKgM3(slurries[i + 1].density);
    if (upper > lower * 1.05) {
      checks.push({
        section: "Плотности",
        title: "Нарушение иерархии плотностей растворов",
        status: "warning",
        detail: `Верхний "${slurries[i].name}" (${upper.toFixed(0)}) плотнее нижнего "${slurries[i + 1].name}" (${lower.toFixed(0)} кг/м³). Возможно замещение на забое.`,
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      section: "Плотности",
      title: "Иерархия плотностей корректна",
      status: "ok",
      detail: `Бур. р-р (${mudDensity.toFixed(0)}) → Буферы → Цемент. Последовательность плотностей обеспечивает стабильное вытеснение.`,
    });
  }

  return checks;
}

function checkFlowRegimes(
  wellData: WellData,
  drillingFluid: DrillingFluid,
  slurries: SlurryInput[],
  buffers: BufferFluid[]
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const annGap = (wellData.holeDiameter - wellData.casingOD) / 1000; // м
  const hydraulicDia = annGap > 0 ? annGap : 0.05;

  // Check cement flow regimes in annulus
  for (const sl of slurries) {
    const rate = getFlowRateLps(sl.flowRateSteps);
    if (rate <= 0) continue;
    const rateM3s = rate / 1000;
    const annArea = (Math.PI / 4) * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);
    if (annArea <= 0) continue;
    const velocity = rateM3s / annArea;
    const dens = densityKgM3(sl.density);
    const cat = cementCategory(sl.density < 100 ? sl.density : sl.density / 1000);
    const rh = effectiveRheology(sl.rheology, cat);
    const re = reynoldsNumber(velocity, hydraulicDia, dens, rh.pv, rh.yp);
    const regime = flowRegimeLabel(re);

    if (re < 2100) {
      checks.push({
        section: "Режимы течения",
        title: `${sl.name}: ламинарный режим (Re=${re.toFixed(0)})`,
        status: "warning",
        detail: `Раствор "${sl.name}" при ${rate.toFixed(1)} л/с: Re=${re.toFixed(0)} — ламинарный режим. Низкая эффективность вытеснения. Рекомендуется увеличить расход или использовать турбулизаторы.`,
      });
    } else if (re >= 3000) {
      checks.push({
        section: "Режимы течения",
        title: `${sl.name}: турбулентный режим (Re=${re.toFixed(0)})`,
        status: "ok",
        detail: `Раствор "${sl.name}" при ${rate.toFixed(1)} л/с: Re=${re.toFixed(0)} — турбулентный режим. Обеспечивает хорошее вытеснение.`,
      });
    } else {
      checks.push({
        section: "Режимы течения",
        title: `${sl.name}: переходный режим (Re=${re.toFixed(0)})`,
        status: "warning",
        detail: `Раствор "${sl.name}" при ${rate.toFixed(1)} л/с: Re=${re.toFixed(0)} — переходный режим. Рекомендуется увеличить расход для перехода в турбулентный.`,
      });
    }
  }

  // Check buffer flow regimes
  for (const buf of buffers) {
    const rate = getFlowRateLps(buf.flowRateSteps);
    if (rate <= 0) continue;
    const rateM3s = rate / 1000;
    const annArea = (Math.PI / 4) * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);
    if (annArea <= 0) continue;
    const velocity = rateM3s / annArea;
    const dens = densityKgM3(buf.density);
    const rh = effectiveRheology(buf.rheology, "buffer");
    const re = reynoldsNumber(velocity, hydraulicDia, dens, rh.pv, rh.yp);

    if (re >= 3000) {
      checks.push({
        section: "Режимы течения",
        title: `Буфер "${buf.name}": турбулентный (Re=${re.toFixed(0)})`,
        status: "ok",
        detail: `Буфер обеспечивает турбулентное течение — эффективная промывка контактных зон.`,
      });
    } else {
      checks.push({
        section: "Режимы течения",
        title: `Буфер "${buf.name}": ${flowRegimeLabel(re)} (Re=${re.toFixed(0)})`,
        status: "warning",
        detail: `Рекомендуется увеличить расход буфера для турбулентного режима и лучшей промывки.`,
      });
    }
  }

  return checks;
}

function checkCentralization(
  centralizationResults: CentralizationResult[] | null,
  wellData: WellData
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  if (!centralizationResults || centralizationResults.length === 0) {
    checks.push({
      section: "Центрирование",
      title: "Данные центрирования отсутствуют",
      status: "warning",
      detail: "Расчёт центрирования не выполнен. Невозможно оценить standoff. Рекомендуется выполнить расчёт центрирования для полного анализа.",
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
      section: "Центрирование",
      title: "Standoff соответствует требованиям",
      status: "ok",
      detail: `Мин. standoff: ${minStandoff.toFixed(1)}%, средний: ${avgStandoff.toFixed(1)}%. Все интервалы ≥ 67%.`,
    });
  } else if (critical.length > 0) {
    const depths = critical.slice(0, 3).map(r => `${r.md.toFixed(0)}м (${r.standoff.toFixed(1)}%)`).join(", ");
    checks.push({
      section: "Центрирование",
      title: "Критически низкий standoff",
      status: "critical",
      detail: `${critical.length} точек с standoff < 50%: ${depths}. Высокий риск каналообразования. Необходимо добавить центраторы или изменить схему.`,
    });
  } else {
    const depths = belowTarget.slice(0, 3).map(r => `${r.md.toFixed(0)}м (${r.standoff.toFixed(1)}%)`).join(", ");
    checks.push({
      section: "Центрирование",
      title: "Standoff ниже рекомендуемого",
      status: "warning",
      detail: `${belowTarget.length} точек с standoff < 67%: ${depths}. Возможны дефекты сцепления. Рассмотреть усиление центрирования.`,
    });
  }

  return checks;
}

function checkThickeningTime(
  slurries: SlurryInput[],
  wellData: WellData,
  buffers: BufferFluid[],
  displacementFluids: DisplacementFluid[]
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  for (const sl of slurries) {
    if (sl.thickeningTime50Bc <= 0) {
      checks.push({
        section: "Время загустевания",
        title: `${sl.name}: время загустевания не задано`,
        status: "warning",
        detail: `Для раствора "${sl.name}" не указано время загустевания. Невозможно оценить безопасность операции.`,
      });
      continue;
    }

    // Estimate total pumping time (rough)
    const height = getSlurryHeight([sl], 0, wellData.casingDepthMD);
    const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
    const annArea = (Math.PI / 4) * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);
    const pipeArea = (Math.PI / 4) * (casingID / 1000) ** 2;

    // Rough volume estimate
    const annVolM3 = annArea * height;
    const rate = getFlowRateLps(sl.flowRateSteps);
    const rateM3min = rate > 0 ? (rate / 1000) * 60 : 0.01;

    // Cement pumping time
    const cementPumpTime = rateM3min > 0 ? annVolM3 / rateM3min : 0;

    // Displacement time (rough: pipe volume / rate)
    let dispRate = 0;
    for (const df of displacementFluids) {
      const r = getFlowRateLps(df.flowRateSteps);
      if (r > dispRate) dispRate = r;
    }
    const dispRateM3min = dispRate > 0 ? (dispRate / 1000) * 60 : rateM3min;
    const pipeVolM3 = pipeArea * wellData.casingDepthMD;
    const dispTime = dispRateM3min > 0 ? pipeVolM3 / dispRateM3min : 0;

    // Buffer time
    let bufTime = 0;
    for (const buf of buffers) {
      const br = getFlowRateLps(buf.flowRateSteps);
      const brM3min = br > 0 ? (br / 1000) * 60 : rateM3min;
      bufTime += brM3min > 0 ? buf.volume / brM3min : 0;
    }

    const totalWorkTime = bufTime + cementPumpTime + dispTime + 15; // +15 мин на техоперации
    const safeTime = sl.thickeningTime50Bc * 0.75;

    if (totalWorkTime > safeTime) {
      checks.push({
        section: "Время загустевания",
        title: `${sl.name}: превышен лимит безопасного времени`,
        status: "critical",
        detail: `Расчётное время операции ~${totalWorkTime.toFixed(0)} мин. Безопасное время (75% от ${sl.thickeningTime50Bc} мин) = ${safeTime.toFixed(0)} мин. Риск схватывания в трубах!`,
      });
    } else {
      const margin = safeTime - totalWorkTime;
      checks.push({
        section: "Время загустевания",
        title: `${sl.name}: запас времени ${margin.toFixed(0)} мин`,
        status: margin > 30 ? "ok" : "warning",
        detail: `Расчётное время ~${totalWorkTime.toFixed(0)} мин, безопасное: ${safeTime.toFixed(0)} мин (75% от ${sl.thickeningTime50Bc}). Запас: ${margin.toFixed(0)} мин.${margin < 30 ? " Запас менее 30 мин — рекомендуется пересмотреть рецептуру." : ""}`,
      });
    }
  }

  return checks;
}

function checkRheology(
  slurries: SlurryInput[],
  drillingFluid: DrillingFluid,
  buffers: BufferFluid[]
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  // Check if rheology is default (not specified)
  for (const sl of slurries) {
    if (sl.rheology.pv === 0 && sl.rheology.yp === 0) {
      checks.push({
        section: "Реология",
        title: `${sl.name}: используются значения по умолчанию`,
        status: "warning",
        detail: `Реология раствора "${sl.name}" не задана — используются стандартные значения. Для точного анализа рекомендуется указать фактическую реологию.`,
      });
    }
  }

  if (drillingFluid.rheology.pv === 0 && drillingFluid.rheology.yp === 0) {
    checks.push({
      section: "Реология",
      title: "Реология бурового раствора по умолчанию",
      status: "warning",
      detail: "Используются стандартные значения PV/YP для бурового раствора. Укажите фактическую реологию для повышения точности.",
    });
  }

  // Check for very high YP (may cause high friction)
  for (const sl of slurries) {
    const cat = cementCategory(sl.density < 100 ? sl.density : sl.density / 1000);
    const rh = effectiveRheology(sl.rheology, cat);
    if (rh.yp > 15) {
      checks.push({
        section: "Реология",
        title: `${sl.name}: высокое ДНС (YP=${rh.yp} Па)`,
        status: "warning",
        detail: `Высокое ДНС увеличивает трение в затрубье и давление на забое. Возможен риск ГРП на слабых интервалах.`,
      });
    }
  }

  // Check fluid loss
  if (drillingFluid.fluidLoss > 10) {
    checks.push({
      section: "Реология",
      title: `Водоотдача бурового раствора: ${drillingFluid.fluidLoss} мл/30мин`,
      status: drillingFluid.fluidLoss > 15 ? "critical" : "warning",
      detail: `Водоотдача ${drillingFluid.fluidLoss} мл/30мин.${drillingFluid.fluidLoss > 15 ? " Критически высокая — возможно формирование толстой корки, ухудшающей сцепление." : " Рекомендуется снизить до < 8 мл/30мин перед цементированием."}`,
    });
  }

  return checks;
}

function checkBuffers(
  buffers: BufferFluid[],
  wellData: WellData
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  if (buffers.length === 0) {
    checks.push({
      section: "Буферные жидкости",
      title: "Буферные жидкости отсутствуют",
      status: "warning",
      detail: "Цементирование без буферных жидкостей. Рекомендуется использовать минимум одну буферную жидкость для улучшения вытеснения и совместимости.",
    });
    return checks;
  }

  // Check contact time (volume-based estimate)
  const annArea = (Math.PI / 4) * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);
  for (const buf of buffers) {
    if (annArea > 0 && buf.volume > 0) {
      const bufHeight = buf.volume / annArea;
      const rate = getFlowRateLps(buf.flowRateSteps);
      if (rate > 0) {
        const rateM3s = rate / 1000;
        const velocity = rateM3s / annArea;
        const contactTime = velocity > 0 ? bufHeight / velocity : 0;
        if (contactTime < 600) { // < 10 минут
          checks.push({
            section: "Буферные жидкости",
            title: `"${buf.name}": время контакта ${(contactTime / 60).toFixed(1)} мин`,
            status: contactTime < 300 ? "critical" : "warning",
            detail: `Время контакта буфера ${(contactTime / 60).toFixed(1)} мин.${contactTime < 300 ? " Критически мало (< 5 мин). Рекомендуется увеличить объём буфера." : " Рекомендуемое время контакта ≥ 10 мин."}`,
          });
        } else {
          checks.push({
            section: "Буферные жидкости",
            title: `"${buf.name}": время контакта ${(contactTime / 60).toFixed(1)} мин`,
            status: "ok",
            detail: `Время контакта буфера ${(contactTime / 60).toFixed(1)} мин — достаточное для эффективной промывки.`,
          });
        }
      }
    }
  }

  return checks;
}

function checkWellGeometry(wellData: WellData): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  // Basic data completeness
  if (wellData.wellDepthMD <= 0) {
    checks.push({
      section: "Скважина",
      title: "Глубина скважины не задана",
      status: "critical",
      detail: "Необходимо задать глубину скважины для корректного расчёта.",
    });
    return checks;
  }

  // Check annular clearance
  const clearance = wellData.holeDiameter - wellData.casingOD;
  if (clearance < 20) {
    checks.push({
      section: "Скважина",
      title: `Малый зазор ствол-колонна: ${clearance.toFixed(0)} мм`,
      status: "critical",
      detail: `Кольцевой зазор ${clearance.toFixed(0)} мм — высокий риск прихвата и неравномерного заполнения. Минимум рекомендуемый: 25 мм.`,
    });
  } else if (clearance < 30) {
    checks.push({
      section: "Скважина",
      title: `Зазор ствол-колонна: ${clearance.toFixed(0)} мм`,
      status: "warning",
      detail: `Зазор ${clearance.toFixed(0)} мм — умеренный. Критически важна хорошая центрация.`,
    });
  }

  // Check cavern coefficient
  if (wellData.cavernCoeff > 1.3) {
    checks.push({
      section: "Скважина",
      title: `Высокая кавернозность: ${wellData.cavernCoeff.toFixed(2)}`,
      status: "warning",
      detail: `Коэффициент кавернозности ${wellData.cavernCoeff.toFixed(2)} — увеличенный объём открытого ствола. Возможны проблемы с полным замещением в кавернах.`,
    });
  }

  // Temperature
  if (wellData.bottomTempStatic > 100) {
    checks.push({
      section: "Скважина",
      title: `Высокая забойная температура: ${wellData.bottomTempStatic}°C`,
      status: "warning",
      detail: `BHST ${wellData.bottomTempStatic}°C. Необходимо убедиться в термостойкости цементной рецептуры и замедлителей.`,
    });
  }

  return checks;
}

function checkDisplacement(
  displacementFluids: DisplacementFluid[]
): AnalysisCheck[] {
  const checks: AnalysisCheck[] = [];

  if (displacementFluids.length === 0) {
    checks.push({
      section: "Продавка",
      title: "Жидкость продавки не задана",
      status: "warning",
      detail: "Параметры продавки не указаны. Невозможно рассчитать время операции.",
    });
    return checks;
  }

  for (const df of displacementFluids) {
    if (df.compressionCoeff > 1.1) {
      checks.push({
        section: "Продавка",
        title: `Высокий коэффициент сжатия: ${df.compressionCoeff}`,
        status: "warning",
        detail: `Коэффициент сжатия ${df.compressionCoeff} (>${1.1}). Убедитесь, что учтён реальный сжимаемый объём.`,
      });
    }
  }

  return checks;
}

// ─── Summary & Report Generation ─────────────────────────────────

function generateSummaryStats(checks: AnalysisCheck[]) {
  const ok = checks.filter(c => c.status === "ok").length;
  const warn = checks.filter(c => c.status === "warning").length;
  const crit = checks.filter(c => c.status === "critical").length;
  return { ok, warn, crit, total: checks.length };
}

function generateMarkdownReport(
  wellData: WellData,
  slurries: SlurryInput[],
  checks: AnalysisCheck[]
): string {
  const stats = generateSummaryStats(checks);
  const now = new Date().toLocaleString("ru-RU");

  let md = `# 📋 Алгоритмический анализ качества цементирования\n\n`;
  md += `> **Дисклеймер**: Данный отчёт сформирован автоматически на основе введённых расчётных данных. Окончательное решение принимает ответственный инженер.\n\n`;

  md += `## 🔍 Общая информация\n\n`;
  md += `| Параметр | Значение |\n`;
  md += `|---|---|\n`;
  md += `| Дата анализа | ${now} |\n`;
  md += `| Глубина MD | ${wellData.wellDepthMD} м |\n`;
  md += `| Глубина TVD | ${wellData.wellDepthTVD || wellData.wellDepthMD} м |\n`;
  md += `| Спуск ОК | ${wellData.casingDepthMD} м |\n`;
  md += `| ОК | Ø${wellData.casingOD} мм × ${wellData.casingWall} мм |\n`;
  md += `| Ствол | Ø${wellData.holeDiameter} мм |\n`;
  md += `| Кол-во растворов | ${slurries.length} |\n\n`;

  md += `## 📊 Итоговая оценка\n\n`;
  md += `| Статус | Кол-во |\n`;
  md += `|---|---|\n`;
  md += `| ✅ Норма | ${stats.ok} |\n`;
  md += `| ⚠️ Предупреждения | ${stats.warn} |\n`;
  md += `| 🔴 Критические | ${stats.crit} |\n`;
  md += `| **Всего проверок** | **${stats.total}** |\n\n`;

  if (stats.crit > 0) {
    md += `**Общая оценка: 🔴 Имеются критические замечания — требуется корректировка перед операцией.**\n\n`;
  } else if (stats.warn > 0) {
    md += `**Общая оценка: ⚠️ Имеются предупреждения — рекомендуется рассмотреть указанные замечания.**\n\n`;
  } else {
    md += `**Общая оценка: ✅ Параметры соответствуют стандартным требованиям.**\n\n`;
  }

  // Group checks by section
  const sections = [...new Set(checks.map(c => c.section))];

  for (const section of sections) {
    md += `## ${section}\n\n`;
    const sectionChecks = checks.filter(c => c.section === section);

    for (const check of sectionChecks) {
      md += `### ${statusEmoji(check.status)} ${check.title}\n\n`;
      md += `${check.detail}\n\n`;
    }
  }

  md += `## 📝 Рекомендации\n\n`;

  const critChecks = checks.filter(c => c.status === "critical");
  const warnChecks = checks.filter(c => c.status === "warning");

  if (critChecks.length > 0) {
    md += `**Критические (необходимо устранить):**\n\n`;
    critChecks.forEach((c, i) => {
      md += `${i + 1}. **${c.title}** — ${c.section}\n`;
    });
    md += `\n`;
  }

  if (warnChecks.length > 0) {
    md += `**Предупреждения (рекомендуется рассмотреть):**\n\n`;
    warnChecks.forEach((c, i) => {
      md += `${i + 1}. ${c.title} — ${c.section}\n`;
    });
    md += `\n`;
  }

  if (critChecks.length === 0 && warnChecks.length === 0) {
    md += `Все проверенные параметры в пределах нормы. Операция может быть выполнена в соответствии с расчётом.\n\n`;
  }

  md += `---\n\n`;
  md += `*DeAllsoft — алгоритмический инженерный анализ. Версия 1.0*\n`;

  return md;
}

// ─── Document content section ────────────────────────────────────

function generateDocumentSection(documentTexts: { name: string; text: string; error?: string }[]): string {
  if (!documentTexts || documentTexts.length === 0) return "";

  let md = `## 📄 Извлечённые данные из документов\n\n`;

  const successful = documentTexts.filter(d => d.text.trim().length > 0);
  const failed = documentTexts.filter(d => d.error);

  if (failed.length > 0) {
    md += `**Не удалось прочитать:**\n\n`;
    failed.forEach(d => {
      md += `- ⚠️ ${d.name}: ${d.error}\n`;
    });
    md += `\n`;
  }

  for (const doc of successful) {
    md += `### 📎 ${doc.name}\n\n`;
    // Truncate very long texts
    const maxLen = 3000;
    const text = doc.text.length > maxLen
      ? doc.text.slice(0, maxLen) + `\n\n... (обрезано, всего ${doc.text.length} символов)`
      : doc.text;
    md += `${text}\n\n`;
  }

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
  documentTexts?: { name: string; text: string; error?: string }[]
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

  let markdown = generateMarkdownReport(wellData, slurries, checks);

  // Append document content if available
  if (documentTexts && documentTexts.length > 0) {
    markdown += "\n" + generateDocumentSection(documentTexts);
  }

  return {
    timestamp: new Date().toISOString(),
    wellSummary: `${wellData.wellDepthMD}м MD, ${slurries.length} р-р(ов)`,
    checks,
    markdown,
  };
}
