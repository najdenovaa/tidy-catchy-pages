import {normalizeMovingPlugCase,simulateMovingPlug,type MovingPlugCase} from './moving-plug';
import {simulatePlugAle} from './plug-ale';
export interface PlugBenchSettings {plugBenchCase?:MovingPlugCase;plugAleEnabled?:boolean;plugAleCells?:number;plugAleSwitchSec?:number}
export function plugBenchKey(s:PlugBenchSettings|undefined){return JSON.stringify(['plug-bench-ale-v1',normalizeMovingPlugCase(s?.plugBenchCase),s?.plugAleEnabled===true,s?.plugAleCells??8,s?.plugAleSwitchSec??0]);}
export function evaluatePlugBench(s:PlugBenchSettings){if(!s.plugBenchCase)return undefined;return s.plugAleEnabled?simulatePlugAle(s.plugBenchCase,s.plugAleCells??8,s.plugAleSwitchSec??0):simulateMovingPlug(s.plugBenchCase);}
