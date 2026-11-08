// @vitest-environment node
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import Component from './Centralizer3DInspector';
import { pcCentralizers } from '@/lib/pc-centralizers';
const spec=pcCentralizers.find(p=>p.spec.passport?.model==='ПЦ-2-168/222')!.spec;
it('renders finite-width plate sections and longitudinal deformation from the support, not the target percentage',()=>{
 const render=(support:number,target:number)=>renderToStaticMarkup(<Component spec={spec} result={{md:2500,tvd:2300,zenith:25,eccentricity:.6,supportEccentricity:support,standoff:40,spanSagMM:13.5,lateralLoadKN:1.4,hasCentralizer:true,hasTurbulizer:false,turbulenceMultiplier:1,intervalId:'1'}} casingOD={168} casingID={152} boreDiameter={222} cased={false} targetStandoff={target}/>);
 const a=render(.1,40),b=render(.5,40),c=render(.1,80);
 const svgs=(s:string)=>[...s.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(x=>x[0]);
 expect(a).toContain('Продольный профиль планки 1');
 expect(a).toContain('Вид вдоль оси');
 expect(a).not.toMatch(/NaN|Infinity/);
 expect(svgs(a)).not.toEqual(svgs(b));
 expect(svgs(a)).toEqual(svgs(c)); // target labels alone never invent a deformation
 expect(a).toContain('Монтажное сжатие');
 const dir=process.env.CENTRALIZER_QA_DIR;
 if(dir){mkdirSync(dir,{recursive:true});for(const [name,s] of [['low',a],['high',b]])svgs(s).forEach((v,i)=>writeFileSync(`${dir}/${name}-${i}.svg`,v));}
});
