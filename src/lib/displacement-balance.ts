/** Independent boundary-flux ledger. All volumes represent the full modeled circumference. */
export interface AnnularBalanceFrame {
 initialM3:number[];sourceInM3:number[];boundaryInM3:number[];outletM3:number[];insideM3:number[];
 clippingM3:number[];normalizationM3:number[];residualM3:number[];unexplainedM3:number[];quantizationM3:number[];
}
export const ANNULAR_BALANCE_NOTE='Независимый покомпонентный контроль: исходно + подано источником + обратный приток - вышло - осталось. Потоки накоплены по граничным граням каждого шага, остаток интегрирован отдельно по ячейкам. Обрезка и нормировка долей - численные изменения объёма, а не подача жидкости. Невязка показана без их сокрытия; округление кадров 1/255 вынесено отдельно. Объёмы приведены к полной моделируемой окружности.';
export class AnnularVolumeLedger {
 readonly sourceIn:Float64Array;readonly boundaryIn:Float64Array;readonly outlet:Float64Array;readonly clipping:Float64Array;readonly normalization:Float64Array;readonly initial:number[];
 constructor(readonly volumes:Float64Array,initial:Float64Array[],readonly factor:number){this.initial=initial.map(c=>this.integrate(c));const n=initial.length;this.sourceIn=new Float64Array(n);this.boundaryIn=new Float64Array(n);this.outlet=new Float64Array(n);this.clipping=new Float64Array(n);this.normalization=new Float64Array(n);}
 integrate(c:ArrayLike<number>){let v=0;for(let k=0;k<this.volumes.length;k++)v+=this.volumes[k]*c[k];return v*this.factor;}
 snapshot(c:Float64Array[],packed:Uint8Array):AnnularBalanceFrame{
  const N=this.volumes.length,inside=c.map(x=>this.integrate(x)),rounded=c.map(()=>0);
  for(let k=0;k<N;k++){let sum=0;for(let f=0;f<c.length;f++)sum+=packed[f*N+k];if(sum>0)for(let f=0;f<c.length;f++)rounded[f]+=this.volumes[k]*this.factor*packed[f*N+k]/sum;}
  const residual=inside.map((v,f)=>this.initial[f]+this.sourceIn[f]+this.boundaryIn[f]-this.outlet[f]-v);
  return {initialM3:[...this.initial],sourceInM3:Array.from(this.sourceIn),boundaryInM3:Array.from(this.boundaryIn),outletM3:Array.from(this.outlet),insideM3:inside,clippingM3:Array.from(this.clipping),normalizationM3:Array.from(this.normalization),residualM3:residual,unexplainedM3:residual.map((v,f)=>v+this.clipping[f]+this.normalization[f]),quantizationM3:rounded.map((v,f)=>v-inside[f])};
 }
}
export const BALANCE_COLUMNS=['Жидкость','Исходно, м³','Источник, м³','Обратный приток, м³','Вышло, м³','Осталось, м³','Невязка, м³','Обрезка, м³','Нормировка, м³','Необъяснённая невязка, м³','Округление 3D, м³'];
export function annularBalanceRows(b:AnnularBalanceFrame,names:string[]){return names.map((name,i)=>[name,b.initialM3[i],b.sourceInM3[i],b.boundaryInM3[i],b.outletM3[i],b.insideM3[i],b.residualM3[i],b.clippingM3[i],b.normalizationM3[i],b.unexplainedM3[i],b.quantizationM3[i]] as (number|string)[]);}
