import type {
  FoamLabRow,
  FoamObservation,
  FoamPlanFact,
  FoamSimulation,
  FoamJobInput,
} from "./foam-cement-types";
import { validateFoamJob, FOAM_MODEL_VERSION } from "./foam-cement-engine";
export const LAB_HEADERS =
  "id;source;preparation;pressureMPaAbs;temperatureC;qualityPct;pvCp;ypPa;stabilityMin;thickeningMin;compressiveMPa;permeabilityMd";
export const FACT_HEADERS =
  "timeMin;pumpPressureMPa;slurryRateLps;n2RateStdM3Min;density";
function records(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];
  if (clean.startsWith("[")) {
    const rows = JSON.parse(clean);
    if (!Array.isArray(rows)) throw new Error("Нужен массив строк.");
    return rows;
  }
  const delimiter = clean.split("\n")[0].includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i <= clean.length; i++) {
    const c = clean[i] ?? "\n";
    if (c === '"') {
      if (quoted && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n")) {
      row.push(field.trim().replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (quoted) throw new Error("Незакрытая кавычка в CSV.");
  const keys = rows.shift() ?? [];
  if (new Set(keys).size !== keys.length)
    throw new Error("Повторяющиеся заголовки CSV.");
  return rows.map((r, i) => {
    if (r.length !== keys.length)
      throw new Error(
        `CSV, строка ${i + 2}: число столбцов отличается от заголовка.`,
      );
    return Object.fromEntries(keys.map((k, i) => [k, r[i]]));
  });
}
function num(v: unknown, required = false): number | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error("Отсутствует обязательное числовое поле.");
    return undefined;
  }
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Некорректное число: ${v}`);
  return n;
}
export function importLab(text: string): FoamLabRow[] {
  return records(text).map((r, i) => {
    const row: FoamLabRow = {
      id: String(r.id || `lab-${i + 1}`),
      source: String(r.source || ""),
      preparation: r.preparation as FoamLabRow["preparation"],
      pressureMPaAbs: num(r.pressureMPaAbs, true)!,
      temperatureC: num(r.temperatureC, true)!,
      qualityPct: num(r.qualityPct, true)!,
      pvCp: num(r.pvCp, true)!,
      ypPa: num(r.ypPa, true)!,
      stabilityMin: num(r.stabilityMin),
      thickeningMin: num(r.thickeningMin),
      compressiveMPa: num(r.compressiveMPa),
      permeabilityMd: num(r.permeabilityMd),
    };
    if (
      !row.source ||
      !["pressurized", "atmospheric", "unknown"].includes(row.preparation) ||
      row.pressureMPaAbs <= 0 ||
      row.qualityPct < 0 ||
      row.qualityPct >= 90 ||
      row.pvCp <= 0 ||
      row.ypPa < 0 ||
      row.temperatureC < -30 ||
      row.temperatureC > 250 ||
      [
        row.stabilityMin,
        row.thickeningMin,
        row.compressiveMPa,
        row.permeabilityMd,
      ].some((v) => v !== undefined && v < 0)
    )
      throw new Error(
        `Протокол ${i + 1}: проверьте источник, способ приготовления, Pабс, T, FQ, PV и YP.`,
      );
    return row;
  });
}
export function importObservations(text: string): FoamObservation[] {
  const rows = records(text).map((r) => ({
    timeMin: num(r.timeMin, true)!,
    pumpPressureMPa: num(r.pumpPressureMPa),
    slurryRateLps: num(r.slurryRateLps),
    n2RateStdM3Min: num(r.n2RateStdM3Min),
    density: num(r.density),
  }));
  rows.sort((a, b) => a.timeMin - b.timeMin);
  rows.forEach((r, i) => {
    if (
      r.timeMin < 0 ||
      (i > 0 && r.timeMin <= rows[i - 1].timeMin) ||
      [r.pumpPressureMPa, r.slurryRateLps, r.n2RateStdM3Min, r.density].every(
        (v) => v === undefined,
      ) ||
      [r.pumpPressureMPa, r.slurryRateLps, r.n2RateStdM3Min, r.density].some(
        (v) => v !== undefined && v < 0,
      )
    )
      throw new Error(
        "Факт: нужны уникальные времена >=0 и неотрицательные измерения.",
      );
  });
  return rows;
}
export function compareFoamFact(
  sim: FoamSimulation,
  rows: FoamObservation[],
  offset = 0,
): FoamPlanFact {
  const f = sim.frames;
  const valid = rows
    .map((r) => ({ ...r, timeMin: r.timeMin - offset }))
    .filter((r) => r.timeMin >= 0 && r.timeMin <= sim.summary.durationMin);
  const samples = valid.map((r) => {
    let j = f.findIndex((x) => x.time >= r.timeMin);
    if (j < 0) j = f.length - 1;
    const a = f[Math.max(0, j - 1)],
      b = f[j],
      k = (r.timeMin - a.time) / Math.max(1e-9, b.time - a.time);
    const lerp = (
      key: "pumpPressureMPa" | "n2RateStdM3Min" | "hydroPumpPressureMPa",
    ) => a[key] + (b[key] - a[key]) * k;
    return {
      timeMin: r.timeMin,
      observedPressure: r.pumpPressureMPa ?? null,
      plannedPressure: lerp("pumpPressureMPa"),
      residual:
        r.pumpPressureMPa === undefined
          ? null
          : r.pumpPressureMPa - lerp("pumpPressureMPa"),
      observedN2: r.n2RateStdM3Min ?? null,
      plannedN2: lerp("n2RateStdM3Min"),
      hydro: lerp("hydroPumpPressureMPa"),
    };
  });
  const ps = samples.filter((r) => r.residual !== null);
  let n2 = 0,
    plan = 0,
    covered = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1],
      b = samples[i],
      dt = b.timeMin - a.timeMin;
    if (a.observedN2 !== null && b.observedN2 !== null) {
      n2 += ((a.observedN2 + b.observedN2) * dt) / 2;
      plan += ((a.plannedN2 + b.plannedN2) * dt) / 2;
      covered += dt;
    }
  }
  let numerator = 0,
    denominator = 0;
  ps.forEach((r) => {
    const friction = r.plannedPressure - r.hydro;
    if (friction > 0.05) {
      numerator += friction * (r.observedPressure! - r.hydro);
      denominator += friction * friction;
    }
  });
  const suggested =
    denominator > 0
      ? (sim.input.settings.frictionMultiplier * numerator) / denominator
      : null;
  const fit =
    suggested !== null && suggested >= 0.2 && suggested <= 5 ? suggested : null;
  return {
    samples,
    pressureRMSE: ps.length
      ? Math.sqrt(ps.reduce((n, r) => n + r.residual! ** 2, 0) / ps.length)
      : null,
    pressureBias: ps.length
      ? ps.reduce((n, r) => n + r.residual!, 0) / ps.length
      : null,
    measuredN2StdM3: n2,
    plannedN2SamePeriodStdM3: plan,
    startMin: samples[0]?.timeMin ?? 0,
    endMin: samples.at(-1)?.timeMin ?? 0,
    coveragePct: (100 * covered) / Math.max(1, sim.summary.durationMin),
    suggestedFrictionMultiplier: fit,
    fittedRMSE:
      fit === null
        ? null
        : Math.sqrt(
            ps.reduce(
              (n, r) =>
                n +
                (r.observedPressure! -
                  (r.hydro +
                    ((r.plannedPressure - r.hydro) * fit) /
                      sim.input.settings.frictionMultiplier)) **
                  2,
              0,
            ) / ps.length,
          ),
    warnings: [
      ...(valid.length !== rows.length
        ? ["Часть измерений вне времени операции исключена."]
        : []),
      "RMSE и подбор трения относятся к загруженным точкам; это не независимая валидация. Подобранное трение требует повторного расчёта.",
      "Интеграл N₂ рассчитан трапециями только между соседними измерениями расхода; длинные пропуски снижают достоверность.",
    ],
  };
}
export function readFoamProject(
  text: string,
  current: FoamJobInput,
): FoamJobInput {
  const raw = JSON.parse(text);
  if (raw.modelVersion !== FOAM_MODEL_VERSION || !raw.input)
    throw new Error("Неизвестная версия проекта пеноцементирования.");
  const input = {
    ...raw.input,
    wellData: current.wellData,
    mudDensity: current.mudDensity,
  };
  const errors = validateFoamJob(input);
  if (errors.length) throw new Error(errors.join("\n"));
  return input;
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const quote = (v: unknown) =>
    `"${String(typeof v === "string" && /^[=+@-]/.test(v) ? "'" + v : (v ?? "")).replace(/"/g, '""')}"`;
  return (
    "\uFEFF" +
    [keys, ...rows.map((r) => keys.map((k) => r[k]))]
      .map((r) => r.map(quote).join(";"))
      .join("\n")
  );
}
