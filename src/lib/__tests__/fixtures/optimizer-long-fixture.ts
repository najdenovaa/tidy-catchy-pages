import { qualityInput, qualitySettings } from './optimizer-cleaning-fixture';
export function longOptimizerFixture(){
 const input=qualityInput(),w=input.wellData,factor=10;
 input.wellData={...w,wellDepthMD:w.wellDepthMD*factor,wellDepthTVD:w.wellDepthTVD*factor,casingDepthMD:w.casingDepthMD*factor,ckodDepth:w.ckodDepth*factor,
  trajectory:w.trajectory.map(row=>({...row,md:row.md*factor,tvd:row.tvd*factor})),
  reservoirLayers:w.reservoirLayers.map(row=>({...row,topMD:row.topMD*factor,bottomMD:row.bottomMD*factor})),
  turbulatorDesign:{...w.turbulatorDesign,points:w.turbulatorDesign.points.map(row=>({...row,md:row.md*factor}))},
 };
 input.slurries=input.slurries.map(s=>({...s,thickeningTime30Bc:10000}));
 return {input,settings:{...qualitySettings,minRateLps:30,maxRateLps:30,maxCementRateLps:30,pumpPressureLimitMPa:150}};
}
