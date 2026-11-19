/** Small-strain, isotropic, bonded axisymmetric cylinders; tension is positive. E/stress in MPa, radii/u in m. */
export interface ElasticMaterial {E:number;nu:number;alpha:number}
export function checkElastic(m:ElasticMaterial){if(![m.E,m.nu,m.alpha].every(Number.isFinite)||m.E<=0||m.nu<=-1||m.nu>=.5||m.alpha<0)throw Error('Нужны E>0, -1<ν<0.5 и α≥0');}
export function lame(pi:number,po:number,ri:number,ro:number,r:number){if(![pi,po,ri,ro,r].every(Number.isFinite)||!(ri>0&&ro>ri&&r>=ri&&r<=ro))throw Error('Недопустимый цилиндр Ламе');const A=(pi*ri*ri-po*ro*ro)/(ro*ro-ri*ri),B=(pi-po)*ri*ri*ro*ro/(ro*ro-ri*ri);return {radial:A-B/(r*r),hoop:A+B/(r*r),A,B};}
export function vonMises(r:number,t:number,z:number){return Math.sqrt(((r-t)**2+(t-z)**2+(z-r)**2)/2);}
function solve(a:number[][],b:number[]){const m=a.map((row,i)=>{const k=Math.max(...row.map(Math.abs));if(!(k>0))throw Error('Вырожденная упругая задача');return [...row.map(x=>x/k),b[i]/k];});const n=b.length;for(let k=0;k<n;k++){let p=k;for(let j=k+1;j<n;j++)if(Math.abs(m[j][k])>Math.abs(m[p][k]))p=j;[m[k],m[p]]=[m[p],m[k]];const d=m[k][k];if(Math.abs(d)<1e-13)throw Error('Плохо обусловленная упругая задача');for(let j=k;j<=n;j++)m[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const q=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=q*m[k][j];}}return m.map(row=>row[n]);}
export interface BondedCylinderInput {radii:[number,number,number,number];materials:[ElasticMaterial,ElasticMaterial,ElasticMaterial];deltaT:[number,number,number];deltaPi:number;deltaPo:number;axialStrain:number}
export function bondedCylinders(p:BondedCylinderInput){const rs=p.radii;if(rs.some((r,i)=>!Number.isFinite(r)||r<=0||i>0&&r<=rs[i-1]))throw Error('Радиусы стали, цемента и породы должны возрастать');p.materials.forEach(checkElastic);if(![...p.deltaT,p.deltaPi,p.deltaPo,p.axialStrain].every(Number.isFinite))throw Error('Недопустимая упругая нагрузка');const scale=rs[0],M=p.materials.map((m,i)=>{const G=m.E/(2*(1+m.nu)),l=m.E*m.nu/((1+m.nu)*(1-2*m.nu)),H=(2*G+3*l)*m.alpha*p.deltaT[i];return {G,l,H};});
 const stress=(i:number,r:number)=>{const {G,l,H}=M[i],q=r/scale;return {a:2*(G+l),b:-2*G/q**2,c:l*p.axialStrain-H};};
 const A:number[][]=[],B:number[]=[];const row=()=>Array(6).fill(0),boundary=(i:number,r:number,load:number)=>{const q=stress(i,r),a=row();a[2*i]=q.a;a[2*i+1]=q.b;A.push(a);B.push(load-q.c);};boundary(0,rs[0],-p.deltaPi);boundary(2,rs[3],-p.deltaPo);
 for(let i=0;i<2;i++){const r=rs[i+1],q=r/scale,a=stress(i,r),b=stress(i+1,r),u=row(),t=row();u[2*i]=q;u[2*i+1]=1/q;u[2*i+2]=-q;u[2*i+3]=-1/q;A.push(u);B.push(0);t[2*i]=a.a;t[2*i+1]=a.b;t[2*i+2]=-b.a;t[2*i+3]=-b.b;A.push(t);B.push(b.c-a.c);}
 if([...A.flat(),...B].some(v=>!Number.isFinite(v)))throw Error('Упругая задача вышла за численный диапазон');
 const x=solve(A,B);if(x.some(v=>!Number.isFinite(v)))throw Error('Нечисловое упругое решение');const at=(i:number,r:number)=>{if(i<0||i>2||r<rs[i]-1e-10||r>rs[i+1]+1e-10)throw Error('Точка вне упругого слоя');const a=x[2*i],b=x[2*i+1],q=r/scale,{G,l,H}=M[i],radial=2*(G+l)*a-2*G*b/q**2+l*p.axialStrain-H,hoop=2*(G+l)*a+2*G*b/q**2+l*p.axialStrain-H,z=2*l*a+(2*G+l)*p.axialStrain-H;return {r,radial,hoop,z,u:scale*(a*q+b/q),vme:vonMises(radial,hoop,z)};};
 return {at,coefficients:x,residual:Math.max(...A.map((r,i)=>Math.abs(r.reduce((s,v,j)=>s+v*x[j],0)-B[i]))),interfaces:[rs[1],rs[2]].map((r,i)=>({r,tractionJump:at(i,r).radial-at(i+1,r).radial,displacementJump:at(i,r).u-at(i+1,r).u}))};
}
export interface AxialCell {top:number;bottom:number;tvdTop:number;tvdBottom:number;ri:number;ro:number;piTop:number;piBottom:number;poTop:number;poBottom:number;frPipeMPa:number;frAnnMPa:number;boreRadius:number;temperatureC:number;referenceC:number}
export interface AxialSettings extends ElasticMaterial {steelDensity:number;referenceC:number;bottomLoadKN:number;mode:'free'|'fixed';imposedExtensionM:number;fluidDrag:boolean}
export function axialString(cells:AxialCell[],p:AxialSettings){checkElastic(p);if(!cells.length||![p.steelDensity,p.referenceC,p.bottomLoadKN,p.imposedExtensionM].every(Number.isFinite)||p.steelDensity<=0)throw Error('Недопустимые осевые исходные данные');let N=p.bottomLoadKN*1000,extension=0,compliance=0;const rows=[];
 for(let j=cells.length-1;j>=0;j--){const c=cells[j],As=Math.PI*(c.ro*c.ro-c.ri*c.ri),Ai=Math.PI*c.ri*c.ri,Ao=Math.PI*c.ro*c.ro,L=c.bottom-c.top;if(!Object.values(c).every(Number.isFinite)||!(L>0&&c.ri>0&&c.ro>c.ri&&c.boreRadius>c.ro))throw Error('Недопустимая осевая ячейка');
  if(j===cells.length-1)N+=1e6*(c.piBottom*Ai-c.poBottom*Ao);else{const d=cells[j+1],Aprev=Math.PI*d.ri*d.ri;N+=1e6*c.piBottom*(Ai-Aprev);}
  const weight=p.steelDensity*As*9.80665*(c.tvdBottom-c.tvdTop),drag=p.fluidDrag?1e6*(c.frPipeMPa*Ai-c.frAnnMPa*Math.PI*(c.boreRadius**2-c.ro**2)*c.ro/(c.boreRadius+c.ro)):0;
  // Plug pressure jumps are represented by adjacent pipe-pressure endpoints at the same MD.
  if(j<cells.length-1)N+=1e6*(c.piBottom-cells[j+1].piTop)*Math.PI*cells[j+1].ri**2;
  const nMid=N+(weight+drag)/2,Nbottom=N;N+=weight+drag;
  const pi=(c.piTop+c.piBottom)/2,po=(c.poTop+c.poBottom)/2,radialSum=2*lame(pi,po,c.ri,c.ro,c.ri).A;
  const mechanical=nMid/(p.E*1e6*As)*L,balloon=-p.nu*radialSum/p.E*L,thermal=p.alpha*(c.temperatureC-c.referenceC)*L;
  const dl=mechanical+balloon+thermal;if(![dl,nMid,radialSum].every(Number.isFinite))throw Error('Осевой расчёт вышел за численный диапазон');extension+=dl;compliance+=L/(p.E*1e6*As);rows.push({...c,areaM2:As,NbottomKN:Nbottom/1000,NmidKN:nMid/1000,mechanicalM:mechanical,balloonM:balloon,thermalM:thermal,extensionM:dl,stressZMPa:nMid/As/1e6});
 }
 rows.reverse();const reaction=p.mode==='fixed'?(p.imposedExtensionM-extension)/compliance:0;let u=0;for(const r of rows){r.NmidKN+=reaction/1000;r.NbottomKN+=reaction/1000;r.stressZMPa+=reaction/(r.areaM2*1e6);const restraintM=reaction*(r.bottom-r.top)/(p.E*1e6*r.areaM2);Object.assign(r,{restraintM});r.extensionM+=restraintM;u+=r.extensionM;Object.assign(r,{displacementM:u});}
 return {rows,unrestrainedExtensionM:extension,extensionM:u,reactionKN:reaction/1000,topForceKN:N/1000+reaction/1000};
}
