import { describe, expect, it } from "vitest";
import { pipeFrictionMPa } from "./cementing-calculations";
import { hbFriction } from "./cement-rheology";

/**
 * Independent analytical / SI-unit reference checks for the V1 friction
 * kernel reused by V2. These tests do not change any production calculation.
 */
describe("Hydraulic analytical references for V2", () => {
  it("Newtonian laminar pipe equals Hagen–Poiseuille (Darcy form)", () => {
    const D = 0.1505, L = 1000, q = 0.002, mu = 0.030, rho = 1200;
    const velocity = q / (Math.PI * D * D / 4);
    const referenceMPa = 32 * mu * velocity * L / (D * D) / 1e6;
    const actual = pipeFrictionMPa(q * 1000, L, D * 1000, mu * 1000, 0, rho);
    expect(actual.regime).toBe(0);
    expect(actual.pressureMPa).toBeCloseTo(referenceMPa, 10);
    expect(actual.pressureMPa).toBeCloseTo(0.004765026800316137, 10);
  });

  it("Bingham low-flow branch matches independently evaluated approximation", () => {
    const D = 0.1505, L = 1000, q = 0.002, mu = 0.030, yp = 7, rho = 1200;
    const v = q / (Math.PI * D * D / 4);
    const referenceMPa = (32 * mu * v / (D * D) + 16 * yp / (3 * D)) * L / 1e6;
    const actual = pipeFrictionMPa(2, L, D * 1000, 30, yp, rho);
    expect(actual.regime).toBe(0);
    expect(actual.pressureMPa).toBeCloseTo(referenceMPa, 10);
    expect(actual.pressureMPa).toBeCloseTo(0.2528270423041921, 9);
  });

  it("Blasius turbulent branch matches Fanning pressure-drop reference", () => {
    const D = 0.1505, L = 1000, q = 0.05, mu = 0.001, rho = 1000;
    const v = q / (Math.PI * D * D / 4);
    const reynolds = rho * v * D / mu;
    const fanning = 0.0791 / Math.pow(reynolds, 0.25);
    const referenceMPa = 2 * fanning * rho * v * v * L / D / 1e6;
    const actual = pipeFrictionMPa(50, L, D * 1000, 1, 0, rho);
    expect(actual.regime).toBe(1);
    expect(actual.pressureMPa).toBeCloseTo(referenceMPa, 10);
    expect(actual.pressureMPa).toBeCloseTo(0.3256104388986803, 9);
  });

  it("transition interpolation is bounded between laminar and turbulent branches", () => {
    const D = 0.1505, L = 1000, q = 0.035, mu = 0.030, yp = 7, rho = 1200;
    const v = q / (Math.PI * D * D / 4);
    const re = rho * v * D / (mu + yp * D / (6 * v));
    expect(re).toBeGreaterThan(2100);
    expect(re).toBeLessThan(3000);
    const lam = (32 * mu * v / (D * D) + 16 * yp / (3 * D)) * L / 1e6;
    const turb = (2 * (0.0791 / Math.pow(re, 0.25)) * rho * v * v * L / D) / 1e6;
    const mix = (re - 2100) / 900;
    const expected = lam * (1 - mix) + turb * mix;
    const actual = pipeFrictionMPa(35, L, D * 1000, 30, yp, rho);
    expect(actual.regime).toBe(0.5);
    expect(actual.pressureMPa).toBeCloseTo(expected, 9);
    expect(actual.pressureMPa).toBeCloseTo(0.6534743230147305, 9);
  });

  it("Herschel–Bulkley with n=1 and zero yield reduces to Newtonian laminar pipe", () => {
    const D = 0.1505, L = 1000, q = 0.002, mu = 0.030, rho = 1200;
    const velocity = q / (Math.PI * D * D / 4);
    const expected = 32 * mu * velocity * L / (D * D) / 1e6;
    const result = hbFriction({ tau0: 0, K: mu, n: 1 }, velocity, D, L, rho, "pipe");
    expect(result.regime).toBe(0);
    expect(result.pressureMPa).toBeCloseTo(expected, 7);
  });
});
