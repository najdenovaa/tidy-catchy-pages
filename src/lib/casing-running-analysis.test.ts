import { describe,it,expect } from 'vitest';
import { getCementingExample } from './cementing-example';
import { normalizeWellData } from './cementing-normalizers';
import { calculateCasingRunning,normalizeRunningSettings,runningSurvey,type CasingRunningInput } from './casing-running-analysis';
import { runningBroomSVG } from './casing-running-plot';
import { buildCentralizerJointSchedule } from './cementing-report-data';
const G=9.80665;
function scenario(angle=0):CasingRunningInput {
  const well={...getCementingExample().wellData,casingDepthMD:123,casingOD:168.3,casingWall:8.9,holeDiameter:215.9,prevCasingDepth:0,prevCasingID:244.5,cavernCoeff:1,cavernIntervals:[],casingSections:[],trajectory:[{md:0,tvd:0,zenith:angle,azimuth:0},{md:123,tvd:123*Math.cos(angle*Math.PI/180),zenith:angle,azimuth:0}]};
  return {well,mudDensity:1100,intervals:[],pv:0,yp:0,settings:normalizeRunningSettings({frictionCased:.2,frictionOpenhole:.3})};
}
function tools(i:CasingRunningInput){i.intervals=[{id:'s',fromMD:0,toMD:123,centralizersPerJoint:1,jointLength:12,spec:{type:'spring',bladesCount:6,bladeHeight:25,restoringForce:5,maxAxialLoad:0,passport:{model:'Test',outerDiameter:245,ringOD:185,startingForceKgf:10000}}}];return i;}
describe('physical casing-running and broomstick reference cases',()=>{
  it('vertical hook load equals analytic buoyant steel weight, starts at zero and ends with the surface profile load',()=>{
    const i=scenario(),a=calculateCasingRunning(i),w=i.well;
    const kg=Math.PI/4*((w.casingOD/1000)**2-((w.casingOD-2*w.casingWall)/1000)**2)*7850;
    expect(a.valid).toBe(true);expect(a.broom[0].runIn).toBe(0);
    expect(a.final!.runIn*G).toBeCloseTo(kg*G/1000*(1-1100/7850)*123,8);
    expect(a.final!.runIn).toBeCloseTo(a.final!.pullOut,8);
    expect(a.final!.runIn*G).toBeCloseTo(a.profile[0].runInKN,8);
    expect(a.broom.every((p,n,pts)=>!n||p.runIn>=pts[n-1].runIn)).toBe(true);
  });
  it('straight inclined reference: W(cos I ± μ sin I), with a genuine friction fan',()=>{
    const i=scenario(40),a=calculateCasingRunning(i),v=calculateCasingRunning({...i,settings:{...i.settings,frictionOpenhole:0}}).final!.free;
    const b=v/Math.cos(40*Math.PI/180);
    expect(a.final!.runIn).toBeCloseTo(b*(Math.cos(40*Math.PI/180)-.3*Math.sin(40*Math.PI/180)),8);
    expect(a.final!.pullOut).toBeCloseTo(b*(Math.cos(40*Math.PI/180)+.3*Math.sin(40*Math.PI/180)),8);
    expect(a.final!.runHigh).toBeLessThan(a.final!.runIn);expect(a.final!.pullHigh).toBeGreaterThan(a.final!.pullOut);
  });
  it('uses previous casing shoe and ID; open-hole friction actually changes the answer',()=>{
    const i=scenario(50);i.well.prevCasingDepth=60;
    const a=calculateCasingRunning(i),b=calculateCasingRunning({...i,settings:{...i.settings,frictionOpenhole:.7}});
    expect(b.final!.runIn).toBeLessThan(a.final!.runIn);
    expect(a.profile.every(p=>p.clearanceMM>0)).toBe(true);
  });
  it('wraps azimuth through north without fictitious 358 degree dogleg',()=>{
    const i=scenario(40);i.well.trajectory[0].azimuth=359;i.well.trajectory[1].azimuth=1;
    expect(runningSurvey(i.well.trajectory,61.5).azimuth).toBeCloseTo(360);
    const a=calculateCasingRunning(i);i.well.trajectory[0].azimuth=-1;
    const b=calculateCasingRunning(i);expect(a.final!.pullOut).toBeCloseTo(b.final!.pullOut,7);
  });
  it('counts discrete devices, including the short final joint; starting force is never added as running force',()=>{
    const i=tools(scenario()),a=calculateCasingRunning(i);
    const count=buildCentralizerJointSchedule(123,i.intervals).reduce((s,r)=>s+r.centralizerDepths.length,0);
    expect(a.centralizerCount).toBe(count);expect(count).toBe(11);expect(a.final!.runIn).toBeCloseTo(a.final!.noTools,8);
    expect(a.unknownRunningCount).toBe(11);
    i.intervals[0].spec.passport!.runningForceKgf=10;
    const b=calculateCasingRunning(i);expect((b.final!.noTools-b.final!.runIn)*G).toBeCloseTo(11*10*.00980665,8);
    expect(b.unknownRunningCount).toBe(0);
  });
  it('moves installed tools with pipe instead of leaving them at final well coordinates',()=>{
    const i=tools(scenario());i.intervals[0].fromMD=100;
    const a=calculateCasingRunning(i);const early=a.broom.find(p=>p.md===25)!;
    // Last joint at 120-123 has a device at 122; already in hole when shoe reaches 25.
    expect(early.toolCount).toBeGreaterThan(0);expect(early.toolCount).toBeLessThanOrEqual(a.centralizerCount);
  });
  it('separates speed-dependent viscous resistance, hook tare and actual capacity',()=>{
    const i=scenario();i.pv=30;i.yp=10;
    const base=calculateCasingRunning({...i,settings:{...i.settings,speedMps:0}});
    const moving=calculateCasingRunning({...i,settings:{...i.settings,blockWeightKN:20,maxHookKN:10}});
    expect(moving.profile[0].viscousDragKN).toBeGreaterThan(0);expect(base.profile[0].viscousDragKN).toBe(0);
    expect(moving.final!.runIn*G-moving.profile[0].runInKN).toBeCloseTo(20,8);
    expect(moving.firstCapacityMD).not.toBeNull();
  });
  it('identifies compression without declaring guaranteed sticking; rejects bad survey and dimensions',()=>{
    expect(calculateCasingRunning(scenario(90)).firstCompressionMD).not.toBeNull();
    const i=scenario();i.well.casingWall=100;expect(calculateCasingRunning(i).valid).toBe(false);
    const j=scenario();j.well.trajectory[1].md=0;expect(calculateCasingRunning(j).valid).toBe(false);
  });
  it('fits a known shared friction correction and detects unidentifiable vertical measurements',()=>{
    const i=scenario(50),truth=calculateCasingRunning({...i,settings:{...i.settings,frictionCased:.27,frictionOpenhole:.37}});
    i.settings.measurements=[{md:123,mode:'runIn',hookTF:truth.final!.runIn},{md:123,mode:'pullOut',hookTF:truth.final!.pullOut}];
    const a=calculateCasingRunning(i);expect(a.calibration!.deltaMu).toBeCloseTo(.07,6);expect(a.calibration!.rmseTF).toBeCloseTo(0,6);
    const v=scenario();v.settings.measurements=[{md:123,mode:'runIn',hookTF:4}];
    expect(calculateCasingRunning(v).calibration!.informative).toBe(false);
  });
  it('screens rigid equipment passage through previous casing during descent, not only at final depth',()=>{
    const i=tools(scenario());i.well.holeDiameter=300;i.well.prevCasingDepth=60;i.well.prevCasingID=200;
    i.intervals[0].fromMD=60;i.intervals[0].spec.type='rigid';i.intervals[0].spec.passport!.outerDiameter=230;
    const a=calculateCasingRunning(i);expect(a.firstPassageConflictMD).not.toBeNull();
  });
  it('handles a full-length 3D survey, sectional walls and explicit tally mass with finite loads',()=>{
    const i=tools(scenario());i.well.casingDepthMD=2515;i.intervals[0].toMD=2515;
    i.well.trajectory=[{md:0,tvd:0,zenith:0,azimuth:359},{md:800,tvd:790,zenith:20,azimuth:1},{md:2515,tvd:2200,zenith:60,azimuth:113}];
    i.well.casingSections=[{fromMD:0,toMD:1000,wallThickness:10}];i.settings.pipeWeightKgPerM=38;i.settings.centralizerRunningKN=.1;i.pv=25;i.yp=5;
    const a=calculateCasingRunning(i);expect(a.valid).toBe(true);expect(a.final!.toolCount).toBe(a.centralizerCount);
    expect(a.profile.at(-1)!.md).toBe(2515);expect(a.profile.at(-1)!.runInKN).toBe(0);
    expect(a.broom.length).toBeGreaterThan(90);expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
    expect(a.maxCombinedMPa).toBeGreaterThan(0);
  });
  it('persists settings and measurements and renders the same finite vector figure',()=>{
    const i=scenario();i.settings.measurements=[{md:123,mode:'pullOut',hookTF:5}];
    i.well.runningSettings=i.settings;
    expect(normalizeWellData(JSON.parse(JSON.stringify(i.well))).runningSettings).toEqual(i.settings);
    const svg=runningBroomSVG(calculateCasingRunning(i),i.settings);
    expect(svg).toContain('Глубина башмака');expect(svg).toContain('Замер MD');expect(svg).not.toMatch(/NaN|Infinity/);
  });
});
