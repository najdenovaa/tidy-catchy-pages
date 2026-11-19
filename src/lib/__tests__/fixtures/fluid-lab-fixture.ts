import {getCementingExample} from '../../cementing-example';
import {emptyFluidLab,labFluids,type MixtureTest} from '../../fluid-interaction-lab';
export function labFixture(){
 const ex=getCementingExample();ex.drillingFluid.rheology={pv:20,yp:2,testTemperatureC:50,testPressureMPaAbs:5};delete ex.drillingFluid.rheologyBottomhole;
 ex.buffers=ex.buffers.slice(0,1).map(b=>({...b,rheology:{pv:30,yp:4,testTemperatureC:50,testPressureMPaAbs:5}}));
 const fluids=labFluids(ex),lab={...emptyFluidLab(),temperatureC:50,pressureMPaAbs:5,useMixtures:true};
 lab.mixtures=[.2,.8].map((share,i):MixtureTest=>({id:'M'+i,source:'Lab protocol',temperatureC:50,pressureMPaAbs:5,pvCp:100+i*100,ypPa:10+i*20,observation:'no-anomaly',notes:'Measured binary',fractions:[{fluidId:fluids[0].id,key:fluids[0].key,share:1-share},{fluidId:fluids[1].id,key:fluids[1].key,share}]}));
 ex.wellData.fluidInteractionLab=lab;return {ex,lab,fluids};
}
