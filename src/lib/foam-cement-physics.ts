/** Engineering PVT and homogeneous hydraulics. PR is approximate, not the NIST reference EOS. */
export const FOAM_ATM = 0.101325;
export const FOAM_G = 9.80665;
const R = 8.314462618,
  M = 0.0280134,
  TC = 126.192,
  PC = 3.3958e6,
  OMEGA = 0.0372;
export function nitrogenZ(pressureMPaAbs: number, tempC: number): number {
  if (
    !Number.isFinite(pressureMPaAbs) ||
    pressureMPaAbs <= 0 ||
    !Number.isFinite(tempC) ||
    tempC <= -273.15
  )
    throw new Error(
      "N₂: требуются абсолютное давление >0 и физическая температура.",
    );
  const T = tempC + 273.15,
    P = pressureMPaAbs * 1e6,
    k = 0.37464 + 1.54226 * OMEGA - 0.26992 * OMEGA ** 2;
  const alpha = (1 + k * (1 - Math.sqrt(T / TC))) ** 2;
  const A = 0.45724 * alpha * (P / PC) * (TC / T) ** 2,
    B = 0.0778 * (P / PC) * (TC / T);
  // Z³ + aZ²+bZ+c=0. Largest real root is used for the gas phase.
  const a = B - 1,
    b = A - 3 * B * B - 2 * B,
    c = -A * B + B * B + B ** 3;
  const p = b - (a * a) / 3,
    q = (2 * a ** 3) / 27 - (a * b) / 3 + c,
    D = (q * q) / 4 + p ** 3 / 27;
  let z: number;
  if (D >= 0)
    z =
      Math.cbrt(-q / 2 + Math.sqrt(D)) +
      Math.cbrt(-q / 2 - Math.sqrt(D)) -
      a / 3;
  else {
    const r = 2 * Math.sqrt(-p / 3),
      phi = Math.acos(
        Math.max(-1, Math.min(1, ((3 * q) / (2 * p)) * Math.sqrt(-3 / p))),
      );
    z = Math.max(
      ...[0, 1, 2].map(
        (i) => r * Math.cos((phi + 2 * Math.PI * i) / 3) - a / 3,
      ),
    );
  }
  if (!Number.isFinite(z) || z <= B)
    throw new Error("N₂: решение уравнения состояния вне газовой ветви.");
  return z;
}
export function nitrogenDensity(p: number, t: number) {
  return (p * 1e6 * M) / (nitrogenZ(p, t) * R * (t + 273.15));
}
/** m³ at P,T per standard m³. Standard conditions are explicit and include Zstd. */
export function nitrogenVolumeFactor(p: number, t: number, stdC = 20) {
  return (
    ((((nitrogenZ(p, t) / nitrogenZ(FOAM_ATM, stdC)) * FOAM_ATM) / p) *
      (t + 273.15)) /
    (stdC + 273.15)
  );
}
export function mixtureAt(
  rhoLiquid: number,
  gasStdPerBase: number,
  p: number,
  t: number,
  stdC = 20,
) {
  const gasV = gasStdPerBase * nitrogenVolumeFactor(p, t, stdC),
    factor = 1 + gasV,
    quality = gasV / factor;
  return {
    volumeFactor: factor,
    qualityPct: quality * 100,
    density:
      (rhoLiquid * 1000 + gasStdPerBase * nitrogenDensity(FOAM_ATM, stdC)) /
      factor /
      1000,
    z: nitrogenZ(p, t),
  };
}
export function ratioFromQuality(fq: number, p: number, t: number, stdC = 20) {
  if (fq < 0 || fq >= 95) throw new Error("FQ должен быть от 0 до менее 95%.");
  return fq / (100 - fq) / nitrogenVolumeFactor(p, t, stdC);
}
export function qualityFromDensity(
  base: number,
  target: number,
  p: number,
  t: number,
) {
  const gas = nitrogenDensity(p, t) / 1000;
  return (100 * (base - target)) / (base - gas);
}
export function homogeneousFriction(args: {
  length: number;
  hydraulicD: number;
  velocity: number;
  density: number;
  pvCp: number;
  ypPa: number;
  roughnessMm: number;
  annularOuter?: number;
  annularInner?: number;
}) {
  const a = args,
    v = Math.abs(a.velocity),
    D = a.hydraulicD;
  if (v === 0 || D <= 0) return 0;
  const shear = Math.max(1e-6, (8 * v) / D),
    mu = a.pvCp / 1000 + a.ypPa / shear;
  const Re = (a.density * v * D) / Math.max(1e-7, mu);
  let correction = 1;
  if (a.annularOuter && a.annularInner) {
    const ro = a.annularOuter / 2,
      ri = a.annularInner / 2;
    const den =
      ro ** 4 - ri ** 4 - (ro * ro - ri * ri) ** 2 / Math.log(ro / ri);
    correction =
      den > 1e-16 ? ((ro * ro - ri * ri) * (ro - ri) ** 2) / den : 1.5;
  }
  const lam = (64 * correction) / Math.max(1, Re),
    turb =
      1 /
      (-1.8 *
        Math.log10(
          (a.roughnessMm / 1000 / D / 3.7) ** 1.11 + 6.9 / Math.max(1, Re),
        )) **
        2;
  const weight = Math.max(0, Math.min(1, (Re - 2000) / 2000));
  const f = lam * (1 - weight) + turb * weight;
  return (((f * a.length) / D) * a.density * v * v) / 2 / 1e6;
}
