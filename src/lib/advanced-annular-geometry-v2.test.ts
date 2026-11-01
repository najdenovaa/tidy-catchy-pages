import { describe, it, expect } from "vitest";
import { sectionalAnnularGeometryV2, sectionalAnnulusFrictionV2 } from "./advanced-annular-geometry-v2";
import { annularFrictionMPa } from "./cementing-calculations";

const g={fromMD:0,toMD:1000,casingODmm:168.3,defaultOuterDiameterMm:215.9,
  diameterIntervals:[{fromMD:300,toMD:700,outerDiameterMm:250}]};
describe("V2 detailed annular geometry",()=>{
 it("splits diameter changes and conserves exact annular capacity",()=>{
  const sections=sectionalAnnularGeometryV2(g);
  expect(sections.map(s=>[s.fromMD,s.toMD])).toEqual([[0,300],[300,700],[700,1000]]);
  const v=(600*(215.9**2-168.3**2)+400*(250**2-168.3**2))*Math.PI/4e6;
  expect(sections.reduce((a,s)=>a+s.volumeM3,0)).toBeCloseTo(v,9);
 });
 it("sums resistance for each real diameter",()=>{
  const r=sectionalAnnulusFrictionV2(g,10,1800,{pv:60,yp:8});
  const expected=annularFrictionMPa(10,600,215.9,168.3,60,8,1800).pressureMPa+
    annularFrictionMPa(10,400,250,168.3,60,8,1800).pressureMPa;
  expect(r.pressureLossMPa).toBeCloseTo(expected,9);
 });
 it("allows partial intervals, no flow and rejects impossible geometries",()=>{
  const r=sectionalAnnulusFrictionV2({...g,fromMD:400,toMD:800},0,1200,{pv:20,yp:5});
  expect(r.pressureLossMPa).toBe(0);
  expect(r.segments.map(s=>[s.fromMD,s.toMD])).toEqual([[400,700],[700,800]]);
  expect(()=>sectionalAnnularGeometryV2({...g,diameterIntervals:[{fromMD:0,toMD:100,outerDiameterMm:150}]})).toThrow();
  expect(()=>sectionalAnnularGeometryV2({...g,diameterIntervals:[
   {fromMD:100,toMD:400,outerDiameterMm:220},{fromMD:300,toMD:600,outerDiameterMm:230}]})).toThrow();
 });
});
