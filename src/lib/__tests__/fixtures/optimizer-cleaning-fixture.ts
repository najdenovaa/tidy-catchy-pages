import {normalizeWellData,normalizeBufferFluid,normalizeSlurryInput,normalizeDisplacementFluid} from '../../cementing-normalizers';
import {labFluids,emptyFluidLab} from '../../fluid-interaction-lab';
import {cleaningTarget} from '../../optimizer-cleaning';
import {DEFAULT_OPTIMIZER_SETTINGS,type ProgramInput} from '../../cement-optimizer';
export const qualitySettings={...DEFAULT_OPTIMIZER_SETTINGS,minRateLps:10,maxRateLps:30,maxCementRateLps:30,rateStepLps:10,pumpPressureLimitMPa:100,marginReqMPa:0};
export function qualityInput():ProgramInput{
 const rheology={pv:20,yp:5,testTemperatureC:40,testPressureMPaAbs:5};
 const wellData=normalizeWellData({wellDepthMD:600,wellDepthTVD:400,casingDepthMD:600,holeDiameter:216,casingOD:168,casingWall:9,prevCasingDepth:0,prevCasingID:250,ckodDepth:580,cavernCoeff:1,bottomTempStatic:50,bottomTempCirc:40,annularStandoffPct:100,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:300,tvd:300,zenith:0,azimuth:0},{md:600,tvd:400,zenith:70,azimuth:0}],reservoirLayers:[{name:'Нефть',topMD:450,bottomMD:550,porePressureGrad:1,fracGrad:100,absorbGrad:100,fluidType:'нефть'}],turbulatorDesign:{points:[{id:'template',md:550,bladesCount:4,bladeAngle:45,bladeHeight:8,lengthMm:180,bladeWidthMm:8,sleeveThicknessMm:3}],fluidId:'mud',rateLps:null,threshold:.001,turningEfficiency:1}});
 return {wellData,drillingFluid:{name:'БР',density:1100,rheology:{...rheology,pv:5,yp:1},fluidLoss:5},buffers:[normalizeBufferFluid({name:'Химия',bufferType:'chemical_wash',density:1100,volume:4,rheology,additives:[{name:'ПАВ',percentage:1,percentageType:'bwob',massKg:0}],flowRateSteps:[{rateLps:10,volumeM3:4}]}),normalizeBufferFluid({name:'Тяжёлый',bufferType:'weighted',density:1300,volume:5,rheology:{...rheology,pv:21,yp:6},flowRateSteps:[{rateLps:20,volumeM3:5}]})],slurries:[normalizeSlurryInput({name:'Цемент',density:1.8,topDepthMD:0,rheology:{pv:40,yp:10},thickeningTime30Bc:600,flowRateSteps:[{rateLps:20,volumeM3:0}]})],displacementFluids:[normalizeDisplacementFluid({name:'Продавка',density:1100,rheology:{pv:5,yp:1},flowRateSteps:[{volumeM3:0,rateLps:20}]})],fractureGradient:100,flushTimeMin:0,flushVolumeM3:0};
}
export function withQualityProof(p:ProgramInput){
 const fluids=labFluids(p),t=cleaningTarget(p.wellData);
 p.wellData.fluidInteractionLab={...emptyFluidLab(),temperatureC:40,pressureMPaAbs:5,removal:[{id:'R85',source:'Испытание образца',temperatureC:40,pressureMPaAbs:5,cleanerId:'buffer:0',cleanerKey:fluids[1].key,mudKey:fluids[0].key,fromMD:t.topMD,toMD:t.bottomMD,criticalPa:.01,exposureS:60,removalPct:86,notes:''}]};return p;
}
