import { describe, expect, it } from "vitest";
import { assertV2ReadyForUnifiedRelease, MISSING_V2_FIELDS, V2_COMPATIBILITY } from "./advanced-v2-compatibility";
describe("V2 full pressure result contract gate",()=>{
 it("explicitly records unsupported fields rather than fabricating results",()=>{
   expect(Object.keys(V2_COMPATIBILITY).length).toBeGreaterThan(15);
   expect(MISSING_V2_FIELDS).toContain("freefall");
   expect(MISSING_V2_FIELDS).toContain("depthEnvelope");
   expect(MISSING_V2_FIELDS).toContain("safeFlowRate");
 });
 it("prevents premature replacement of the production calculation",()=>{
   expect(()=>assertV2ReadyForUnifiedRelease()).toThrow("cannot replace");
 });
});
