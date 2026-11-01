/** Pressure required to break gel structure on restart.
 * СНС is an INPUT in Pa at the relevant rest time and temperature.
 * Static ideal wall-yield estimate; excludes compressibility/surge/transient inertia.
 */
export interface GelIntervalV2 {
 fromMD:number;toMD:number;outerDiameterMm:number;innerDiameterMm?:number;
 gelStrengthPa:number;location:"pipe"|"annulus";
}
export interface RestartGelInputV2 {
 intervals:GelIntervalV2[];
 stoppedAtMin:number;restartAtMin:number;
 movingVolumeM3:number;breakdownVolumeM3:number;
 baselinePressureMPa:number;
}
export function calculateRestartGelV2(input:RestartGelInputV2){
 if(![input.stoppedAtMin,input.restartAtMin,input.movingVolumeM3,input.breakdownVolumeM3,
   input.baselinePressureMPa].every(Number.isFinite)||input.stoppedAtMin<0||
   input.restartAtMin<input.stoppedAtMin||input.movingVolumeM3<0||
   input.breakdownVolumeM3<=0)throw Error("Invalid restart conditions");
 let gelPressureMPa=0;
 const contributions=input.intervals.map(s=>{
  if(![s.fromMD,s.toMD,s.outerDiameterMm,s.innerDiameterMm??0,s.gelStrengthPa].every(Number.isFinite)||
   s.fromMD<0||s.toMD<=s.fromMD||s.outerDiameterMm<=0||s.gelStrengthPa<0||
   (s.location==="annulus"&&(!(s.innerDiameterMm!>0)||s.outerDiameterMm<=s.innerDiameterMm!)))
   throw Error("Invalid gel interval");
  if(s.location!=="pipe"&&s.location!=="annulus")throw Error("Invalid fluid location");
  const hydraulicDiameterM=s.location==="pipe"?s.outerDiameterMm/1000:
   (s.outerDiameterMm-s.innerDiameterMm!)/1000;
  const pressureMPa=4*s.gelStrengthPa*(s.toMD-s.fromMD)/hydraulicDiameterM/1e6;
  gelPressureMPa+=pressureMPa;
  return {...s,pressureMPa};
 });
 const remainingFraction=Math.max(0,1-input.movingVolumeM3/input.breakdownVolumeM3);
 return {restTimeMin:input.restartAtMin-input.stoppedAtMin,
  initialBreakPressureMPa:input.baselinePressureMPa+gelPressureMPa,
  gelPressureMPa,remainingGelPressureMPa:gelPressureMPa*remainingFraction,
  plottedPressureMPa:input.baselinePressureMPa+gelPressureMPa*remainingFraction,
  contributions,model:"ideal-wall-gel-yield-linear-volume-decay" as const};
}
/** Data points consumed by pressure-time graphs; never an independent plot formula. */
export function restartPressureSeriesV2(input:Omit<RestartGelInputV2,"movingVolumeM3">,
 volumesM3:number[]){
 return volumesM3.map(movingVolumeM3=>({
  movingVolumeM3,...calculateRestartGelV2({...input,movingVolumeM3})
 }));
}
