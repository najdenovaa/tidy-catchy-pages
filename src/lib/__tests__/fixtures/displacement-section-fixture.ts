import {getCementingExample} from '../../cementing-example';
import {buildPipeTransport} from '../../displacement-pipe';
import type {DisplacementReportData} from '../../cementing-report-data';
export function sectionFixture():DisplacementReportData{
 const ex=getCementingExample(),w={...ex.wellData,casingDepthMD:20,casingOD:168.3,casingWall:8.9,casingSections:[],annularStandoffPct:50,standoffProfile:[]};
 const fluids=[{name:'Буровой раствор',kind:'mud' as const,density:1100,pv:.02,yp:3},{name:'Цемент G',kind:'cement' as const,density:1850,pv:.04,yp:8}];
 const v=Math.PI*((w.casingOD-2*w.casingWall)/2000)**2*10;
 const pipe=buildPipeTransport(fluids,[{topMD:0,bottomMD:10,startM3:0,endM3:v},{topMD:10,bottomMD:20,startM3:v,endM3:2*v}],[{fluid:1,volumeM3:1.5*v,rateM3s:1.5*v/10}]);
 const result={nZ:2,nTheta:2,full:false,zCenters:new Float64Array([5,15]),gap:new Float32Array([.03,.01,.03,.01]),fluids,rows:[{standoff:.5},{standoff:.5}],snapshots:[{t:0,stage:0,frac:new Uint8Array([255,255,255,255,0,0,0,0])},{t:10,stage:0,frac:new Uint8Array([0,255,0,255,255,0,255,0])}]} as DisplacementReportData['result'];
 return {inputKey:'section-unit-fixture',result,pipe,stages:[],meta:{sectionWell:w,colors:['#387d55','#64748b'],annulusStartS:0,designCementTopMD:0,shoeMD:20,notes:[]},timeline:[{timeS:0,annulusFrame:0},{timeS:10,annulusFrame:1}],selectedDepthMD:15,selectedGlobalFrame:1,selectedFrame:1,settings:{fine:false,settleMin:0,rotationRpm:0}};
}
