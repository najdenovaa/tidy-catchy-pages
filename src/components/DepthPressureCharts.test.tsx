import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {useState} from 'react';
import DepthPressureCharts from './DepthPressureCharts';
import {DEFAULT_DEPTH_CHART} from '@/lib/depth-chart-settings';
afterEach(cleanup);
vi.mock('recharts',async()=>{const React=await import('react');return Object.fromEntries(['ComposedChart','Area','Line','XAxis','YAxis','CartesianGrid','Tooltip','Legend','ResponsiveContainer','ReferenceLine'].map(name=>[name,(p:any)=>React.createElement('div',{'data-chart':name,'data-key':p.dataKey,'data-label':typeof p.label==='object'?p.label.value:undefined,'data-y':p.y,'data-values':p.data?JSON.stringify(p.data):undefined},p.children)]));});
it('saves coordinated presentation controls and moves the shoe reference to the actual TVD in feet',()=>{
 const saved=vi.fn();function App(){const [s,set]=useState(DEFAULT_DEPTH_CHART);return <DepthPressureCharts settings={s} onSettingsChange={v=>{set(v);saved(v);}} prevShoeMD={100} casingDepthMD={200} envelope={[0,100,200].map((md,i)=>({md,tvd:[0,80,80][i],maxPressureMPa:10,minPressureMPa:5,minHydrostaticMPa:4,wocHydrostaticMPa:3,porePressureMPa:null,fracPressureMPa:12,poreFromLayer:false,maxAtStage:'Цемент'}))}/>;}
 const r=render(<App/>);fireEvent.change(screen.getByLabelText('Координата глубинных графиков'),{target:{value:'TVD'}});fireEvent.change(screen.getByLabelText('Единицы глубинных графиков'),{target:{value:'ft'}});fireEvent.change(screen.getByLabelText('Единицы давления по глубине'),{target:{value:'psi'}});fireEvent.change(screen.getByLabelText('Единицы ЭЦП по глубине'),{target:{value:'ppg'}});
 const charts=r.container.querySelectorAll('[data-chart="ComposedChart"]'),pressure=JSON.parse(charts[0].getAttribute('data-values')!),ecd=JSON.parse(charts[1].getAttribute('data-values')!);expect(pressure[1].max).toBeCloseTo(1450.3773773,6);expect(pressure[1].depth).toBeCloseTo(80/.3048,8);expect(ecd).toHaveLength(3);expect(ecd[0].max).toBeNull();expect(ecd[1].max).toBeCloseTo(10/(.00981*80)*8.345404452,6);
 expect(saved.mock.lastCall![0]).toEqual({coordinate:'TVD',depthUnit:'ft',pressureUnit:'psi',densityUnit:'ppg'});
 expect(r.container.querySelector('[data-chart="YAxis"]')?.getAttribute('data-label')).toBe('Глубина TVD, ft');
 expect(Number(r.container.querySelector('[data-chart="ReferenceLine"]')?.getAttribute('data-y'))).toBeCloseTo(80/.3048,8);
});

it('an older/reset project without display settings restores MD and metric units in controlled mode',()=>{
 const envelope=[0,100].map(md=>({md,tvd:md*.8,maxPressureMPa:10,minPressureMPa:5,minHydrostaticMPa:4,wocHydrostaticMPa:3,porePressureMPa:null,fracPressureMPa:12,poreFromLayer:false,maxAtStage:'Цемент'})),onSettingsChange=vi.fn();
 const r=render(<DepthPressureCharts envelope={envelope} casingDepthMD={100} prevShoeMD={0} settings={{...DEFAULT_DEPTH_CHART,coordinate:'TVD',depthUnit:'ft'}} onSettingsChange={onSettingsChange}/>);
 r.rerender(<DepthPressureCharts envelope={envelope} casingDepthMD={100} prevShoeMD={0} onSettingsChange={onSettingsChange}/>);
 expect(screen.getByLabelText('Координата глубинных графиков')).toHaveValue('MD');expect(screen.getByLabelText('Единицы глубинных графиков')).toHaveValue('m');
});
