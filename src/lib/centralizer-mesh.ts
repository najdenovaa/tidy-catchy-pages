import type { CentralizerSpec } from './centralization-calculations';
import { inspectCentralizer } from './centralizer-clearance';
export type Vec3 = [number, number, number];
export interface Face { points:Vec3[]; kind:'steel'|'red'|'edge'|'selected'; }
export function trajectoryAzimuth(trajectory:{md:number;azimuth:number}[],md:number) {
 if(!trajectory.length)return 0;
 if(md<=trajectory[0].md)return trajectory[0].azimuth;
 for(let i=1;i<trajectory.length;i++)if(md<=trajectory[i].md){const a=trajectory[i-1],b=trajectory[i];const delta=((b.azimuth-a.azimuth+540)%360)-180;return (a.azimuth+delta*(md-a.md)/(b.md-a.md)+360)%360;}
 return trajectory[trajectory.length-1].azimuth;
}
/** Local +X is the gravity low side; +Z points uphole. Camera orbit must not reverse this basis. */
export function surveyTransform([x,y,z]:Vec3,zenith:number,azimuth:number):Vec3 {
 const t=zenith*Math.PI/180,a=azimuth*Math.PI/180;
 const u=-x*Math.cos(t)-z*Math.sin(t);
 return [u*Math.cos(a)+y*Math.sin(a),u*Math.sin(a)-y*Math.cos(a),-x*Math.sin(t)+z*Math.cos(t)].map(v=>Math.abs(v)<1e-12?0:v) as Vec3;
}
export function centralizerMesh(spec:CentralizerSpec,casingOD:number,casingID:number,bore:number,ecc:number,selected:number):Face[] {
 const g=inspectCentralizer(spec,casingOD,bore,ecc);if(!g)return [];
 const p=spec.passport!;const faces:Face[]=[];
 const add=(points:Vec3[],kind:Face['kind'])=>faces.push({points,kind});
 const cyl=(r:number,ri:number,z0:number,z1:number,kind:Face['kind'])=>{
  const steps=Math.max(2,Math.ceil((z1-z0)/10));
  for(let i=0;i<64;i++){
   const a=i*Math.PI/32,b=(i+1)*Math.PI/32;
   const v=(r:number,a:number,z:number):Vec3=>[g.offset+r*Math.cos(a),r*Math.sin(a),z];
   for(let j=0;j<steps;j++){
    const low=z0+(z1-z0)*j/steps,high=z0+(z1-z0)*(j+1)/steps;
    add([v(r,a,low),v(r,b,low),v(r,b,high),v(r,a,high)],kind);
    add([v(ri,b,low),v(ri,a,low),v(ri,a,high),v(ri,b,high)],'edge');
   }
   for(const z of [z0,z1])add([v(ri,a,z),v(ri,b,z),v(r,b,z),v(r,a,z)],kind);
  }
 };
 cyl(g.pipeRadius,casingID/2,-g.length*.82,g.length*.82,'steel');
 const ringRadius=p.ringOD?p.ringOD/2:Math.max(g.pipeRadius+3,(p.innerDiameter??casingOD)/2+2);
 const activeLength=p.springLength??g.length*.72;
 const ringLength=p.ringLength??(g.length-activeLength)/2;
 const ringInner=(p.innerDiameter??casingOD+2)/2;
 cyl(ringRadius,ringInner,-g.length/2,-g.length/2+ringLength,spec.type==='spring'?'red':'edge');
 cyl(ringRadius,ringInner,g.length/2-ringLength,g.length/2,spec.type==='spring'?'red':'edge');
 const width=p.bladeWidth??Math.min(40,Math.PI*ringRadius/spec.bladesCount*.45);
 const thick=p.materialThickness??2;
 const halfAngle=width/(2*ringRadius);
 const bowLength=g.length-2*ringLength;
 for(const b of g.blades){
  const vertex=(t:number,side:number,inside:boolean):Vec3=>{
   const twist=spec.type==='spring'?0:((p.bladeAngle??0)*Math.PI/180)*(t-.5)*bowLength/Math.max(1,b.freeRadius);
   const a=b.angle+side*halfAngle+twist;
   const free=spec.type==='spring'?ringRadius+(b.freeRadius-ringRadius)*Math.sin(Math.PI*t):ringRadius+(b.freeRadius-ringRadius)*Math.sin(Math.PI*t)**.3;
   const wall=-g.offset*Math.cos(a)+Math.sqrt(g.boreRadius**2-g.offset**2*Math.sin(a)**2);
   const compression=Math.max(0,b.freeRadius-b.loadedRadius);
   const deformed=free-compression*16*t*t*(1-t)*(1-t);
   const radius=(spec.type==='spring'?Math.min(deformed,Math.max(g.pipeRadius+thick,wall)):free)-(inside?thick:0);
   return [g.offset+radius*Math.cos(a),radius*Math.sin(a),(t-.5)*bowLength];
  };
  for(let j=0;j<40;j++){const t=j/40,u=(j+1)/40;for(const inside of [false,true])add([vertex(t,-1,inside),vertex(t,1,inside),vertex(u,1,inside),vertex(u,-1,inside)],inside?'edge':selected===b.index?'selected':spec.type==='spring'?'red':'steel');for(const side of [-1,1])add([vertex(t,side,false),vertex(t,side,true),vertex(u,side,true),vertex(u,side,false)],'edge');}
 }
 return faces;
}
