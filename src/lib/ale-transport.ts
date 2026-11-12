/** Conservative implicit upwind component transport on a prescribed 1D moving mesh.
 * Fluxes MUST be relative to moving faces: rho (u-w) A, kg/s. No momentum solve here.
 */
export interface AleState {facesM:number[];massKg:number[];fractions:number[][]}
export interface AleStep {state:AleState;injectedKg:number[];returnedKg:number[];maxMassResidualKg:number;maxGeometricResidualM3:number}
function solve(l:number[],d:number[],u:number[],rhs:number[]){const b=[...rhs],a=[...d];for(let i=1;i<a.length;i++){if(!(a[i-1]>0))throw new Error('Вырожденная ALE-матрица.');const w=l[i]/a[i-1];a[i]-=w*u[i-1];b[i]-=w*b[i-1];}const x=a.map(()=>0);x[x.length-1]=b.at(-1)!/a.at(-1)!;for(let i=x.length-2;i>=0;i--)x[i]=(b[i]-u[i]*x[i+1])/a[i];return x;}
export function advanceAle(old:AleState,facesM:number[],massKg:number[],relativeFluxKgS:number[],dt:number,areaM2:number,leftFractions:number[],rightFractions?:number[],sealedFace?:number):AleStep{
 const n=old.massKg.length,nf=leftFractions.length,finite=(a:number[])=>a.every(Number.isFinite),validFractions=(a:number[])=>a.length===nf&&finite(a)&&a.every(x=>x>=0)&&Math.abs(a.reduce((s,x)=>s+x,0)-1)<1e-8;
 if(!n||!nf||n>120||nf>20||!(dt>0&&Number.isFinite(dt)&&areaM2>0&&Number.isFinite(areaM2))||facesM.length!==n+1||old.facesM.length!==n+1||massKg.length!==n||relativeFluxKgS.length!==n+1||old.fractions.length!==n||![facesM,old.facesM,massKg,old.massKg,relativeFluxKgS].every(finite)||massKg.some(x=>x<=0)||old.massKg.some(x=>x<=0)||old.fractions.some(f=>!validFractions(f))||!validFractions(leftFractions)||rightFractions&&!validFractions(rightFractions))throw new Error('Недопустимые ALE-сетка, массы или состав.');
 if(sealedFace!==undefined&&(!Number.isInteger(sealedFace)||sealedFace<1||sealedFace>=n||relativeFluxKgS[sealedFace]!==0))throw new Error('Через герметичную подвижную границу задан ненулевой поток.');
 if(relativeFluxKgS[n]<0&&!rightFractions)throw new Error('Не задан состав обратного притока справа.');
 let maxGeometricResidualM3=0;
 for(let i=0;i<n;i++){
  const oldV=areaM2*(old.facesM[i+1]-old.facesM[i]),newV=areaM2*(facesM[i+1]-facesM[i]);if(!(oldV>0&&newV>0&&Number.isFinite(oldV)&&Number.isFinite(newV)))throw new Error('Неположительная ALE-ячейка.');
  const sweptLeft=areaM2*(facesM[i]-old.facesM[i]),sweptRight=areaM2*(facesM[i+1]-old.facesM[i+1]);const geometricResidual=newV-oldV-sweptRight+sweptLeft;if(![sweptLeft,sweptRight,geometricResidual].every(Number.isFinite)||Math.abs(geometricResidual)>1e-10*Math.max(1,oldV,newV,Math.abs(sweptLeft),Math.abs(sweptRight)))throw new Error('Геометрический ALE-баланс не сошёлся.');maxGeometricResidualM3=Math.max(maxGeometricResidualM3,Math.abs(geometricResidual));
  if(Math.abs(massKg[i]-old.massKg[i]+dt*(relativeFluxKgS[i+1]-relativeFluxKgS[i]))>1e-8*Math.max(1,old.massKg[i],massKg[i]))throw new Error('Потоки ALE не согласованы с изменением массы ячейки.');
 }
 const lower=massKg.map((_,i)=>i>0?-dt*Math.max(relativeFluxKgS[i],0):0),upper=massKg.map((_,i)=>i<n-1?dt*Math.min(relativeFluxKgS[i+1],0):0),diagonal=massKg.map((m,i)=>m+dt*(Math.max(relativeFluxKgS[i+1],0)+Math.max(-relativeFluxKgS[i],0))),fractions=massKg.map(()=>Array(nf).fill(0));
 for(let j=0;j<nf;j++){const rhs=old.massKg.map((m,i)=>m*old.fractions[i][j]+(i===0?dt*Math.max(relativeFluxKgS[0],0)*leftFractions[j]:0)+(i===n-1?dt*Math.max(-relativeFluxKgS[n],0)*(rightFractions?.[j]??0):0)),x=solve(lower,diagonal,upper,rhs);for(let i=0;i<n;i++)fractions[i][j]=x[i];}
 if(fractions.some(f=>!validFractions(f)))throw new Error('Нарушена положительность или сумма долей ALE.');
 const injectedKg=leftFractions.map((f,j)=>dt*(Math.max(relativeFluxKgS[0],0)*f+Math.max(-relativeFluxKgS[n],0)*(rightFractions?.[j]??0))),returnedKg=leftFractions.map((_,j)=>dt*(Math.max(relativeFluxKgS[n],0)*fractions[n-1][j]+Math.max(-relativeFluxKgS[0],0)*fractions[0][j]));
 let maxMassResidualKg=0;
 for(let i=0;i<n;i++)for(let j=0;j<nf;j++){
  const incoming=relativeFluxKgS[i]*(i===0?(relativeFluxKgS[0]>=0?leftFractions[j]:fractions[0][j]):relativeFluxKgS[i]>=0?fractions[i-1][j]:fractions[i][j]);
  const outgoing=relativeFluxKgS[i+1]*(i===n-1?(relativeFluxKgS[n]>=0?fractions[n-1][j]:rightFractions![j]):relativeFluxKgS[i+1]>=0?fractions[i][j]:fractions[i+1][j]);
  const residual=massKg[i]*fractions[i][j]-old.massKg[i]*old.fractions[i][j]+dt*(outgoing-incoming);maxMassResidualKg=Math.max(maxMassResidualKg,Math.abs(residual));if(Math.abs(residual)>1e-8*Math.max(1,old.massKg[i]))throw new Error('Компонентный ALE-баланс не сошёлся.');
 }
 return {state:{facesM:[...facesM],massKg:[...massKg],fractions},injectedKg,returnedKg,maxMassResidualKg,maxGeometricResidualM3};
}
