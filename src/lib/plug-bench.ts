import {evaluateCoupledRefinement} from './coupled-refinement';
import {simulateCoupledPlug} from './coupled-plug';
import {evaluatePlugPressure} from './plug-pressure';
import {normalizeMovingPlugCase,simulateMovingPlug,type MovingPlugCase} from './moving-plug';
import {simulatePlugAle} from './plug-ale';
export interface PlugBenchSettings {plugBenchCase?:MovingPlugCase;plugStudyEnabled?:boolean;plugCoupledEnabled?:boolean;plugHydraulicsEnabled?:boolean;plugViscosityMpas?:number;plugAleEnabled?:boolean;plugAleCells?:number;plugAleSwitchSec?:number}
export function plugBenchKey(s:PlugBenchSettings|undefined){return JSON.stringify(['plug-bench-refinement-v1',normalizeMovingPlugCase(s?.plugBenchCase),s?.plugAleEnabled===true,s?.plugAleCells??8,s?.plugAleSwitchSec??0,s?.plugHydraulicsEnabled===true,s?.plugViscosityMpas??10,s?.plugCoupledEnabled===true,s?.plugStudyEnabled===true]);}
export function evaluatePlugBench(s:PlugBenchSettings){if(!s.plugBenchCase)return undefined;const r=s.plugAleEnabled?simulatePlugAle(s.plugBenchCase,s.plugAleCells??8,s.plugAleSwitchSec??0):simulateMovingPlug(s.plugBenchCase);if(s.plugAleEnabled&&s.plugHydraulicsEnabled)r.hydraulics=evaluatePlugPressure(r,s.plugAleCells??8,s.plugViscosityMpas??10,s.plugAleSwitchSec??0);if(s.plugAleEnabled&&s.plugHydraulicsEnabled&&s.plugCoupledEnabled)r.coupled=simulateCoupledPlug(r.input,s.plugAleCells??8,s.plugViscosityMpas??10,s.plugAleSwitchSec??0);if(r.coupled&&s.plugStudyEnabled)r.study=evaluateCoupledRefinement(r.input,s.plugAleCells??8,s.plugViscosityMpas??10,s.plugAleSwitchSec??0,r.coupled);return r;}
