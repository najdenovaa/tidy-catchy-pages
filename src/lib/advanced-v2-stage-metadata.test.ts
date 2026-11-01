import {it,expect} from "vitest";
import {calculateV2StageMetadata} from "./advanced-v2-stage-metadata";
it("accounts for pump stops in cement start and final stop times",()=>{
 const m=calculateV2StageMetadata([
  {name:"Буфер",rateLps:10,volumeM3:6,pauseAfterMin:5},
  {name:"Цемент",rateLps:10,volumeM3:6}], [1]);
 expect(m.cementStartTime).toBe(15);
 expect(m.stopTime).toBe(25);
 expect(m.pumpedVolumeM3).toBe(12);
 expect(m.stageBoundaries.map(x=>x.time)).toEqual([0,10,15]);
});
it("rejects an invalid cement stage",()=>{
 expect(()=>calculateV2StageMetadata([{name:"A",rateLps:10,volumeM3:6}],[2])).toThrow();
});
