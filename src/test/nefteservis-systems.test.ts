import { describe, expect, it } from "vitest";
import { assessReadySystem, NEFTESERVIS_SYSTEMS } from "@/components/ReadyCementAlternatives";

describe("Nefteservis catalog published operating ranges", () => {
  it("has distinct official HTTPS product links and valid ranges", () => {
    expect(NEFTESERVIS_SYSTEMS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(NEFTESERVIS_SYSTEMS.map(s => s.id)).size).toBe(NEFTESERVIS_SYSTEMS.length);
    for (const s of NEFTESERVIS_SYSTEMS) {
      expect(s.url.startsWith("https://nefteserv.ru/")).toBe(true);
      expect(s.densityMin).toBeLessThan(s.densityMax);
      expect(s.tempMin).toBeLessThan(s.tempMax);
    }
  });
  it("matches only known density and temperature inside both published ranges", () => {
    const ocs = NEFTESERVIS_SYSTEMS.find(s=>s.id==="ocs")!;
    expect(assessReadySystem(ocs,1.5,60)).toBe("range");
    expect(assessReadySystem(ocs,1.5,5)).toBe("outside");
    expect(assessReadySystem(ocs,1.85,60)).toBe("outside");
    expect(assessReadySystem(ocs,1.5)).toBe("unknown");
    expect(assessReadySystem(ocs,0,60)).toBe("unknown");
  });
  it("recognizes arctic system at 5 Celsius and rejects heat", () => {
    const acs = NEFTESERVIS_SYSTEMS.find(s=>s.id==="acs")!;
    expect(assessReadySystem(acs,1.5,5)).toBe("range");
    expect(assessReadySystem(acs,1.5,50)).toBe("outside");
  });
});
