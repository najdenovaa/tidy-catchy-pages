import { it, expect } from "vitest";
import { calculateAnnulusV2 } from "./advanced-annulus-v2";
it("exports annular model", () => { expect(typeof calculateAnnulusV2).toBe("function"); });
