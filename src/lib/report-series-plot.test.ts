import {it,expect} from 'vitest';
import {reportSeriesPlot} from './report-series-plot';
it('draws interval-ending average rates with an immediate vertical then horizontal step',()=>{
 const stepped=reportSeriesPlot('Q','rate',[0,1,2],'min','l/s',[{name:'Q',color:'#000',values:[0,10,0],curve:'stepBefore'}]).svg;
 const paths=[...stepped.matchAll(/<path d="([^"]*)" fill="none"/g)];expect(paths).toHaveLength(1);
 const vertices=[...paths[0][1].matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
 expect(vertices).toHaveLength(5);expect(vertices[1][0]).toBe(vertices[0][0]);expect(vertices[2][1]).toBe(vertices[1][1]);expect(vertices[3][0]).toBe(vertices[2][0]);expect(vertices[4][1]).toBe(vertices[3][1]);
 const linear=reportSeriesPlot('P','pressures',[0,1],'min','MPa',[{name:'P',color:'#000',values:[0,10]}]).svg;
 expect([...linear.matchAll(/<path d="([^"]*)" fill="none"/g)][0][1].match(/[ML]/g)).toHaveLength(2);
});
