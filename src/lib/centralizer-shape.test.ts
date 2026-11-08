import { it, expect } from 'vitest';
import { centralizerShape, bladePoint, bladeRadius, bladeCurve, bladeSection, displayCentralizerPoint } from './centralizer-shape';
import { passportExamples } from './centralizer-passports';
import { pcCentralizers } from './pc-centralizers';
import { getCementingExample } from './cementing-example';
import { autoPlaceCentralizers, calculateCentralization } from './centralization-calculations';
const spec = passportExamples[2].spec;
it('shares physical endpoints and peak compression between the bow and midspan section', () => {
  const g=centralizerShape(spec,178,216,.5)!,b=g.blades[0];
  expect(bladeRadius(g,b,0)).toBeCloseTo(g.ringRadius);
  expect(bladeRadius(g,b,1)).toBeCloseTo(g.ringRadius);
  expect(bladeRadius(g,b,.5)).toBeCloseTo(b.loadedRadius);
  expect(bladeRadius(g,b,.5,'free')-bladeRadius(g,b,.5)).toBeCloseTo(b.compression);
  const section=bladeSection(g,b);
  expect(section[8]).toEqual(bladePoint(g,b,.5));
  expect(bladeCurve(g,b)[32]).toEqual(section[8]);
});
it('keeps the entire finite-width strip in the bore and outside the pipe when clearance permits', () => {
  for(const ecc of [0,.2,.5,.8]) {
    const g=centralizerShape(spec,178,216,ecc)!;
    for(const b of g.blades)for(let j=0;j<=64;j++)for(const side of [-1,0,1])for(const inside of [false,true]) {
      const p=bladePoint(g,b,j/64,side,inside);
      expect(Math.hypot(p[0],p[1])).toBeLessThanOrEqual(g.boreRadius+1e-7);
      expect(Math.hypot(p[0]-g.offset,p[1])).toBeGreaterThanOrEqual(g.pipeRadius-1e-7);
    }
  }
});
it('separates installation preload from signed load compression or unloading', () => {
  const oversized={...spec,passport:{...spec.passport!,outerDiameter:260}};
  const g=centralizerShape(oversized,178,216,.4)!;
  expect(g.blades[0].mountingCompression).toBe(22);
  expect(g.blades[0].loadCompression).toBeCloseTo(g.offset);
  expect(g.blades[3].loadCompression).toBeCloseTo(-g.offset);
  expect(g.blades[0].compression).toBeGreaterThan(g.blades[3].compression);
});
it('preserves contact after display amplification at all blade angles, without changing physical mm', () => {
  const g=centralizerShape({...spec,passport:{...spec.passport!,outerDiameter:260}},178,216,.4)!;
  const original=JSON.stringify(g);
  for(const gain of [1,6,12]) for(const b of g.blades) {
    const p=bladePoint(g,b,.5);
    expect(Math.hypot(p[0],p[1])).toBeCloseTo(g.boreRadius,7);
    const borePoint:[number,number,number]=[p[0]/Math.hypot(p[0],p[1])*g.boreRadius,p[1]/Math.hypot(p[0],p[1])*g.boreRadius,p[2]];
    expect(displayCentralizerPoint(g,p,gain)).toEqual(expect.arrayContaining(displayCentralizerPoint(g,borePoint,gain).map(x=>expect.closeTo(x,7))));
  }
  expect(JSON.stringify(g)).toBe(original);
});
it('changes actual lower-blade compression when the target changes the auto placement and support load', () => {
  const w={...getCementingExample().wellData,wellDepthMD:300,casingDepthMD:300,casingOD:168,casingWall:8,holeDiameter:222,prevCasingDepth:0,prevCasingID:0,cavernCoeff:1,
    trajectory:[{md:0,tvd:0,zenith:45,azimuth:0},{md:300,tvd:212,zenith:45,azimuth:0}]};
  const device=pcCentralizers.find(p=>p.spec.passport?.model==='ПЦ-2-168/222')!.spec;
  const run=(target:number)=>{
    const placement=autoPlaceCentralizers(w,device,12,target,1100);
    const intervals=placement.map((p,i)=>({id:String(i),fromMD:p.fromMD,toMD:p.toMD,jointLength:12,centralizersPerJoint:p.centralizersPerJoint,spec:device}));
    const r=calculateCentralization(w,intervals,1100,undefined,undefined,{fromMD:150,toMD:150})[0];
    return {r,g:centralizerShape(device,168,222,r.supportEccentricity!)!};
  };
  const lower=run(30),higher=run(80);
  expect(lower.r.lateralLoadKN!).toBeGreaterThan(higher.r.lateralLoadKN!);
  expect(lower.g.blades[0].compression).toBeGreaterThan(higher.g.blades[0].compression);
  expect(bladeCurve(lower.g,lower.g.blades[0])).not.toEqual(bladeCurve(higher.g,higher.g.blades[0]));
});
