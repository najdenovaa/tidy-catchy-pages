/** Exact fully developed laminar circular-pipe constitutive law, SI inputs. */
export interface BenchRheology {model:'newtonian'|'bingham'|'hb'|'invalid';viscosityMpas:number;yieldPa:number;consistencyPaSn:number;flowIndex:number}
export interface BenchRheologyPair {back:BenchRheology;ahead:BenchRheology}
export interface PipeLaw {tau0:number;K:number;n:number}
export function defaultBenchRheology(mu:number):BenchRheology{return {model:'newtonian',viscosityMpas:mu,yieldPa:0,consistencyPaSn:mu/1000,flowIndex:1};}
export function normalizeBenchRheology(v:unknown):BenchRheology|undefined{if(v===undefined)return undefined;if(!v||typeof v!=='object'||Array.isArray(v))return {model:'invalid',viscosityMpas:-1,yieldPa:-1,consistencyPaSn:-1,flowIndex:-1};const x=v as Record<string,unknown>,num=(k:string)=>typeof x[k]==='number'&&Number.isFinite(x[k])?x[k] as number:-1;return {model:['newtonian','bingham','hb'].includes(x.model as string)?x.model as BenchRheology['model']:'invalid',viscosityMpas:num('viscosityMpas'),yieldPa:num('yieldPa'),consistencyPaSn:num('consistencyPaSn'),flowIndex:num('flowIndex')};}
export function rheologyPairKey(pair?:BenchRheologyPair){return pair?[normalizeBenchRheology(pair.back)??null,normalizeBenchRheology(pair.ahead)??null]:null;}
export function pipeLaw(r:BenchRheology):PipeLaw{let law:PipeLaw;if(r.model==='newtonian')law={tau0:0,K:r.viscosityMpas/1000,n:1};else if(r.model==='bingham')law={tau0:r.yieldPa,K:r.viscosityMpas/1000,n:1};else if(r.model==='hb')law={tau0:r.yieldPa,K:r.consistencyPaSn,n:r.flowIndex};else throw new Error('Неизвестная модель реологии стенда.');if(![law.tau0,law.K,law.n].every(Number.isFinite)||law.tau0<0||law.K<=0||law.n<.1||law.n>1.2)throw new Error('Реология: нужны τ₀ ≥ 0, K > 0 и 0,1 ≤ n ≤ 1,2.');return law;}
export function resolveBenchLaws(pair:BenchRheologyPair|undefined,mu:number){return pair?{back:pipeLaw(pair.back),ahead:pipeLaw(pair.ahead)}:{back:pipeLaw(defaultBenchRheology(mu)),ahead:pipeLaw(defaultBenchRheology(mu))};}
function assertLaw(l:PipeLaw){if(![l.tau0,l.K,l.n].every(Number.isFinite)||l.tau0<0||l.K<=0||l.n<.1||l.n>1.2)throw new Error('Недопустимые коэффициенты закона течения.');}
export function isNewtonian(l:PipeLaw){return l.tau0===0&&l.n===1;}
export function benchRheologyDescription(r:BenchRheology){if(r.model==='invalid')return 'Недопустимая модель реологии';if(r.model==='newtonian')return `Ньютон: μ ${r.viscosityMpas} мПа·с`;if(r.model==='bingham')return `Бингам: PV ${r.viscosityMpas} мПа·с; τ₀ ${r.yieldPa} Па`;return `Гершель–Балкли: τ₀ ${r.yieldPa} Па; K ${r.consistencyPaSn} Па·с^n; n ${r.flowIndex}`;}
/** Q = pi ∫ gamma(r) r² dr; positive powers avoid cancellation at yield. */
export function hbFlowAtWall(tau:number,radius:number,l:PipeLaw){
 assertLaw(l);
 if(!(Number.isFinite(tau)&&tau>=0&&Number.isFinite(radius)&&radius>0))throw new Error('Недопустимые напряжение или радиус.');
 if(tau<=l.tau0)return {q:0,derivative:0};
 const a=l.tau0/tau,d=1-a,p=1/l.n,c=Math.PI*radius**3*(tau/l.K)**p;
 const f=d**(p+3)/(p+3)+2*a*d**(p+2)/(p+2)+a*a*d**(p+1)/(p+1),g=d**(p+3)/(p+3)+3*a*d**(p+2)/(p+2)+3*a*a*d**(p+1)/(p+1)+a**3*d**p/p;
 const q=c*f,derivative=c*p/tau*g;if(![q,derivative].every(Number.isFinite)||q<0||derivative<0)throw new Error('Не удалось выразить ламинарный расход по реологии.');return {q,derivative};
}
export function wallStressForRate(q:number,diameterMm:number,l:PipeLaw){
 assertLaw(l);
 if(!Number.isFinite(q)||!Number.isFinite(diameterMm)||diameterMm<=0)throw new Error('Недопустимые расход или диаметр.');const v=Math.abs(q),r=diameterMm/2000;if(v===0)return 0;if(isNewtonian(l))return 4*l.K*v/(Math.PI*r**3);
 let lo=l.tau0,hi=Math.max(2*l.tau0+2*l.K*(v*(3+1/l.n)/(Math.PI*r**3))**l.n,1e-12);
 for(let i=0;hbFlowAtWall(hi,r,l).q<v;i++){hi*=2;if(i>80||!Number.isFinite(hi))throw new Error('Не найдено напряжение на стенке для заданного расхода.');}
 for(let i=0;i<58;i++){const mid=(lo+hi)/2;if(hbFlowAtWall(mid,r,l).q<v)lo=mid;else hi=mid;}return (lo+hi)/2;
}
/** Signed Q and positive dQ/d(deltaP), MPa, m, mm; external resistance is in series. */
export function pipeFlowForPressure(dp:number,length:number,diameterMm:number,l:PipeLaw,externalResistance=0){
 assertLaw(l);
 if(![dp,length,diameterMm,externalResistance].every(Number.isFinite)||length<=0||diameterMm<=0||externalResistance<0)throw new Error('Недопустимая геометрия или внешнее сопротивление.');
 const r=diameterMm/2000,c=4*length/(2*r)/1e6,drive=Math.abs(dp);
 if(isNewtonian(l)){const resistance=8*l.K*length/(Math.PI*r**4)/1e6+externalResistance,q=dp/resistance;return {q,derivative:1/resistance,tau:wallStressForRate(q,diameterMm,l)};}
 if(drive<=c*l.tau0)return {q:0,derivative:0,tau:drive/c};
 let tau=drive/c;
 if(externalResistance>0){let lo=l.tau0,hi=tau;for(let j=0;j<52;j++){const mid=(lo+hi)/2;if(c*mid+externalResistance*hbFlowAtWall(mid,r,l).q<drive)lo=mid;else hi=mid;}tau=(lo+hi)/2;}
 const flow=hbFlowAtWall(tau,r,l);return {q:Math.sign(dp)*flow.q,derivative:flow.derivative/(c+externalResistance*flow.derivative),tau};
}
export function yieldPressure(length:number,diameterMm:number,l:PipeLaw){return 4*length*l.tau0/(diameterMm/1000)/1e6;}
