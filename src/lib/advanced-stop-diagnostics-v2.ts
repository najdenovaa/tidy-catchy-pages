/**
 * V2 pump-stop / restart diagnostics for a fixed fluid configuration.
 * A closed, incompressible well at zero pump flow does not advect fluid.
 * U-tube differential is a driving potential, NOT a predicted flow volume or rate.
 * Computing fall volume requires transient momentum, friction and boundary conditions.
 */
import type { AnnulusFluidV2, AnnulusGeometryV2 } from "./advanced-annulus-v2";
import { calculateAnnulusV2 } from "./advanced-annulus-v2";
import { calculatePipePressureProfileV2 } from "./advanced-pipe-pressure-v2";
import type { PipeFluidIntervalV2 } from "./advanced-multifluid-pipe-v2";
import type { PipeFrictionV2Input } from "./advanced-pipe-hydraulics-v2";
import type { TrajectoryPoint } from "./cementing-calculations";
import type { PumpStageV2 } from "./advanced-pipe-advection-v2";

type PipeGeometry=Omit<PipeFrictionV2Input,"densityKgM3"|"rheology">;
export interface StaticStopInputV2 {
 pipe:PipeGeometry;
 pipeFluids:PipeFluidIntervalV2[];
 annulus:AnnulusGeometryV2;
 initialAnnulus:AnnulusFluidV2;
 shoeStream:PumpStageV2[];
 shoeExitedM3:number;
 trajectory:TrajectoryPoint[];
 returnPressureMPa?:number;
}
export function assessStaticStopV2(input:StaticStopInputV2){
 const bp=input.returnPressureMPa??0;
 if(!Number.isFinite(bp)||bp<0)throw Error("Invalid surface return pressure");
 if(input.pipe.fromMD!==input.annulus.topMD||input.pipe.toMD!==input.annulus.shoeMD)
  throw Error("Disconnected static stop geometry");
 const pipe=calculatePipePressureProfileV2({...input.pipe,flowRateLps:0},input.pipeFluids,input.trajectory);
 const ann=calculateAnnulusV2(input.annulus,input.initialAnnulus,input.shoeStream,
  input.shoeExitedM3,0,input.trajectory);
 const drivingPressureMPa=pipe.bottomHydrostaticMPa-(bp+ann.hydrostaticMPa);
 const inletPressureForEquilibriumMPa=-drivingPressureMPa;
 return {
  shoePressureMPa:bp+ann.hydrostaticMPa,
  pipeHydrostaticMPa:pipe.bottomHydrostaticMPa,
  annularHydrostaticMPa:ann.hydrostaticMPa,
  pipeFrictionMPa:0,annularFrictionMPa:0,
  drivingPressureMPa,inletPressureForEquilibriumMPa,
  tendency:drivingPressureMPa>1e-9?"pipe-to-annulus":drivingPressureMPa< -1e-9?"annulus-to-pipe":"equilibrium",
  pumpedVolumeChangeM3:0,
  resultKind:"static-driving-potential-only" as const,
 };
}
