/**
 * Анализ устойчивости ствола скважины (Wellbore Stability)
 *
 * Модель: уравнения Кирша для напряжений вокруг вертикальной/наклонной
 * скважины + критерий разрушения Мора-Кулона (сдвиг) и Гриффита (растяжение).
 *
 * Ссылки:
 *  - Fjær et al. "Petroleum Related Rock Mechanics" (2008)
 *  - Zoback "Reservoir Geomechanics" (2007)
 *  - API RP 90 (управление давлением)
 *
 * Расчёт «окна безопасной плотности бурового раствора» (Safe Mud Weight Window):
 *   MW_kick   — нижний предел по пластовому давлению (защита от ГНВП)
 *   MW_coll   — нижний предел по сдвиговому разрушению (вывалы)
 *   MW_loss   — верхний предел по поглощению
 *   MW_frac   — верхний предел по гидроразрыву пласта (tensile failure)
 */

import type { ReservoirLayer, TrajectoryPoint } from "./cementing-calculations";

export interface RockMechProps {
  /** Прочность на одноосное сжатие, МПа (UCS) */
  ucsMPa: number;
  /** Угол внутреннего трения, ° */
  frictionAngleDeg: number;
  /** Прочность на растяжение, МПа (обычно 0.05–0.1 × UCS) */
  tensileStrengthMPa: number;
  /** Биотта (Biot's α), 0–1, обычно 0.7–1.0 для осадочных пород */
  biot: number;
  /** Коэффициент Пуассона, ν */
  poisson: number;
}

export interface StabilityInput {
  /** TVD интервала, м */
  tvd: number;
  /** Пластовое давление, МПа */
  porePressureMPa: number;
  /** Градиент ГРП пласта, МПа/м (если есть — используется) */
  fracGradMPaPerM?: number;
  /** Градиент поглощения, МПа/м */
  absorbGradMPaPerM?: number;
  /** Свойства породы */
  rock: RockMechProps;
  /** Градиент горного давления (overburden), МПа/м. По умолчанию 0.0226 */
  overburdenGradMPaPerM?: number;
  /** Отношение горизонтальных напряжений к эффективным (K0). По умолчанию из ν */
  k0?: number;
}

export interface StabilityResult {
  tvd: number;
  /** Минимальная плотность по пластовому давлению, г/см³ */
  mwKickGcm3: number;
  /** Минимальная плотность по сдвиговому разрушению (collapse), г/см³ */
  mwCollapseGcm3: number;
  /** Максимальная плотность по поглощению, г/см³ */
  mwLossGcm3: number;
  /** Максимальная плотность по ГРП, г/см³ */
  mwFracGcm3: number;
  /** Нижняя граница окна (макс из kick/collapse), г/см³ */
  mwLowerGcm3: number;
  /** Верхняя граница окна (мин из loss/frac), г/см³ */
  mwUpperGcm3: number;
  /** Ширина окна, г/см³ (отрицательное значение = окна нет) */
  windowWidthGcm3: number;
  /** Главные напряжения, МПа */
  sigmaV_MPa: number;
  sigmaH_MPa: number;
  /** Признак критической зоны: окно < 0.05 г/см³ */
  critical: boolean;
}

/** Перевод плотности (г/см³) в гидростатическое давление (МПа) на TVD (м) */
export function densityToPressureMPa(densityGcm3: number, tvd: number): number {
  return densityGcm3 * 9.81 * tvd / 1000;
}

/** Обратный перевод: давление (МПа) → эквивалентная плотность (г/см³) */
export function pressureToDensityGcm3(pressureMPa: number, tvd: number): number {
  if (tvd <= 0) return 0;
  return (pressureMPa * 1000) / (9.81 * tvd);
}

/**
 * Расчёт устойчивости для одного интервала.
 * Допущение: вертикальная скважина, изотропное горизонтальное поле σH = σh.
 */
export function calcStabilityAtDepth(input: StabilityInput): StabilityResult {
  const { tvd, porePressureMPa: Pp, rock } = input;
  const overGrad = input.overburdenGradMPaPerM ?? 0.0226;

  // Горное давление
  const Sv = overGrad * tvd;

  // K0 по упругой модели (если не задан): K0 = ν / (1-ν)
  const k0 = input.k0 ?? rock.poisson / Math.max(1 - rock.poisson, 0.01);

  // Эффективное напряжение (Терцаги-Биот)
  const SvEff = Sv - rock.biot * Pp;
  const ShEff = k0 * SvEff;
  const Sh = ShEff + rock.biot * Pp;

  // Параметры Мора-Кулона
  const phi = (rock.frictionAngleDeg * Math.PI) / 180;
  const q = Math.pow(Math.tan(Math.PI / 4 + phi / 2), 2); // = (1+sinφ)/(1-sinφ)
  const UCS = rock.ucsMPa;
  const T0 = rock.tensileStrengthMPa;

  // === Сдвиговое разрушение (collapse), точка σθ max на стенке (φ=90°) ===
  // Для верт. скв. при σH=σh: σθ = 2*Sh - Pw (без термо/химии)
  // Условие Мора-Кулона: σθ_eff ≤ UCS + q*σr_eff
  //   σθ_eff = (2*Sh - Pw) - Biot*Pp
  //   σr_eff = Pw - Biot*Pp
  // => 2*Sh - Pw - α*Pp ≤ UCS + q*(Pw - α*Pp)
  // => Pw_collapse = (2*Sh - UCS - α*Pp*(1 - q)) / (1 + q)
  const PwCollapse = (2 * Sh - UCS - rock.biot * Pp * (1 - q)) / (1 + q);

  // === ГРП / tensile failure ===
  // Минимальное σθ на стенке = 2*Sh - Pw. Разрыв при σθ_eff ≤ -T0
  // => 2*Sh - Pw - α*Pp ≤ -T0
  // => Pw_frac = 2*Sh + T0 - α*Pp
  let PwFrac = 2 * Sh + T0 - rock.biot * Pp;

  // Если задан явный градиент ГРП по пласту — берём его (он точнее)
  if (input.fracGradMPaPerM && input.fracGradMPaPerM > 0) {
    PwFrac = input.fracGradMPaPerM * tvd;
  }

  // Поглощение
  const PwLoss = input.absorbGradMPaPerM
    ? input.absorbGradMPaPerM * tvd
    : PwFrac * 0.95;

  // Перевод в плотности
  const mwKick = pressureToDensityGcm3(Pp, tvd);
  const mwCollapse = Math.max(pressureToDensityGcm3(Math.max(PwCollapse, 0), tvd), 0);
  const mwFrac = pressureToDensityGcm3(PwFrac, tvd);
  const mwLoss = pressureToDensityGcm3(PwLoss, tvd);

  const lower = Math.max(mwKick, mwCollapse);
  const upper = Math.min(mwLoss, mwFrac);
  const width = upper - lower;

  return {
    tvd,
    mwKickGcm3: mwKick,
    mwCollapseGcm3: mwCollapse,
    mwLossGcm3: mwLoss,
    mwFracGcm3: mwFrac,
    mwLowerGcm3: lower,
    mwUpperGcm3: upper,
    windowWidthGcm3: width,
    sigmaV_MPa: Sv,
    sigmaH_MPa: Sh,
    critical: width < 0.05,
  };
}

/** Профиль устойчивости по всем пластам */
export function buildStabilityProfile(
  reservoirLayers: ReservoirLayer[],
  trajectory: TrajectoryPoint[],
  rockDefault: RockMechProps,
  overburdenGradMPaPerM = 0.0226
): StabilityResult[] {
  if (!reservoirLayers || reservoirLayers.length === 0) return [];

  // Простая интерполяция MD → TVD
  const tvdAtMD = (md: number): number => {
    if (trajectory.length === 0) return md;
    const sorted = [...trajectory].sort((a, b) => a.md - b.md);
    if (md <= sorted[0].md) return sorted[0].tvd ?? sorted[0].md;
    for (let i = 1; i < sorted.length; i++) {
      if (md <= sorted[i].md) {
        const f = (md - sorted[i - 1].md) / Math.max(sorted[i].md - sorted[i - 1].md, 0.001);
        const tvd0 = sorted[i - 1].tvd ?? sorted[i - 1].md;
        const tvd1 = sorted[i].tvd ?? sorted[i].md;
        return tvd0 + f * (tvd1 - tvd0);
      }
    }
    return sorted[sorted.length - 1].tvd ?? sorted[sorted.length - 1].md;
  };

  return reservoirLayers.map((layer) => {
    const midMD = (layer.topMD + layer.bottomMD) / 2;
    const tvd = tvdAtMD(midMD);
    const ppMPa = (layer.porePressureGrad * tvd) / 1000; // кПа/м * м / 1000 = МПа
    const fracMPaPerM = layer.fracGrad / 1000; // кПа/м → МПа/м
    const absorbMPaPerM = layer.absorbGrad / 1000;
    return calcStabilityAtDepth({
      tvd,
      porePressureMPa: ppMPa,
      fracGradMPaPerM: fracMPaPerM > 0 ? fracMPaPerM : undefined,
      absorbGradMPaPerM: absorbMPaPerM > 0 ? absorbMPaPerM : undefined,
      rock: rockDefault,
      overburdenGradMPaPerM,
    });
  });
}

/** Дефолтные свойства типовых литотипов */
export const ROCK_PRESETS: Record<string, RockMechProps> = {
  shale: { ucsMPa: 25, frictionAngleDeg: 22, tensileStrengthMPa: 2, biot: 0.9, poisson: 0.32 },
  sandstone: { ucsMPa: 55, frictionAngleDeg: 32, tensileStrengthMPa: 4, biot: 0.85, poisson: 0.25 },
  limestone: { ucsMPa: 80, frictionAngleDeg: 35, tensileStrengthMPa: 6, biot: 0.7, poisson: 0.27 },
  salt: { ucsMPa: 20, frictionAngleDeg: 15, tensileStrengthMPa: 1.5, biot: 1.0, poisson: 0.4 },
  coal: { ucsMPa: 15, frictionAngleDeg: 25, tensileStrengthMPa: 1, biot: 0.9, poisson: 0.3 },
};

export interface StabilityRecommendation {
  severity: "ok" | "warn" | "critical";
  text: string;
}

export function generateStabilityRecommendations(
  results: StabilityResult[],
  currentMudDensityGcm3: number
): StabilityRecommendation[] {
  const recs: StabilityRecommendation[] = [];
  if (results.length === 0) return recs;

  const criticalZones = results.filter((r) => r.critical);
  if (criticalZones.length > 0) {
    recs.push({
      severity: "critical",
      text: `Узкое окно (<0.05 г/см³) в ${criticalZones.length} пласте(ах). Требуется управляемое бурение MPD или промежуточная колонна.`,
    });
  }

  for (const r of results) {
    if (currentMudDensityGcm3 < r.mwLowerGcm3 - 0.01) {
      recs.push({
        severity: "critical",
        text: `TVD ${r.tvd.toFixed(0)} м: плотность ${currentMudDensityGcm3.toFixed(2)} ниже минимума ${r.mwLowerGcm3.toFixed(2)} г/см³ — риск ГНВП/вывалов.`,
      });
    } else if (currentMudDensityGcm3 > r.mwUpperGcm3 + 0.01) {
      recs.push({
        severity: "critical",
        text: `TVD ${r.tvd.toFixed(0)} м: плотность ${currentMudDensityGcm3.toFixed(2)} выше предела ${r.mwUpperGcm3.toFixed(2)} г/см³ — риск поглощения/ГРП.`,
      });
    }
  }

  if (recs.length === 0) {
    recs.push({ severity: "ok", text: "Текущая плотность находится в безопасном окне для всех пластов." });
  }

  return recs;
}
