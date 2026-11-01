import {describe,it,expect} from "vitest";
import {buildPumpTimelineV2} from "./advanced-pump-timeline-v2";
describe("pump-stop/restart timeline V2",()=>{
 const s=buildPumpTimelineV2([
  {name:"Buffer",rateLps:10,volumeM3:6,pauseAfterMin:5},
  {name:"Cement",rateLps:20,volumeM3:12}
 ]);
 it("stops without pumping and restarts without losing injected volume",()=>{
  expect(s.durationMin).toBeCloseTo(25,9);
  expect(s.at(10).pumpedM3).toBeCloseTo(6,9);
  expect(s.at(12).rateLps).toBe(0);
  expect(s.at(14).pumpedM3).toBeCloseTo(6,9);
  expect(s.at(16).rateLps).toBe(20);
  expect(s.at(16).pumpedM3).toBeCloseTo(7.2,9);
  expect(s.at(25).pumpedM3).toBeCloseTo(18,9);
 });
 it("rejects invalid stages and out-of-range queries",()=>{
  expect(()=>buildPumpTimelineV2([{name:"Bad",rateLps:0,volumeM3:1}])).toThrow();
  expect(()=>s.at(30)).toThrow();
 });
});
