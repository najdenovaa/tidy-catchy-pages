export interface DepthChartSettings {coordinate:'MD'|'TVD';depthUnit:'m'|'ft';pressureUnit:'MPa'|'kgf'|'psi'|'bar';densityUnit:'gcm3'|'ppg'}
export const DEFAULT_DEPTH_CHART:DepthChartSettings={coordinate:'MD',depthUnit:'m',pressureUnit:'MPa',densityUnit:'gcm3'};
export function normalizeDepthChartSettings(v:unknown):DepthChartSettings{
 const x=(v&&typeof v==='object'?v:{}) as Partial<DepthChartSettings>;
 return {coordinate:x.coordinate==='TVD'?'TVD':'MD',depthUnit:x.depthUnit==='ft'?'ft':'m',pressureUnit:['MPa','kgf','psi','bar'].includes(x.pressureUnit!)?x.pressureUnit!:'MPa',densityUnit:x.densityUnit==='ppg'?'ppg':'gcm3'};
}
export const DEPTH_UNITS={m:{k:1,label:'м'},ft:{k:1/.3048,label:'ft'}};
export const PRESSURE_UNITS={MPa:{k:1,label:'МПа',dec:2},kgf:{k:1/.0980665,label:'кгс/см²',dec:1},psi:{k:1e6/((.45359237*9.80665)/(.0254**2)),label:'psi',dec:1},bar:{k:10,label:'bar',dec:2}};
export const DENSITY_UNITS={gcm3:{k:1,label:'г/см³'},ppg:{k:3.785411784/.45359237,label:'ppg (US)'}};
