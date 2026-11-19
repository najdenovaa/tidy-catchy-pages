import * as THREE from 'three';
import {frames} from './displacement-geometry';
import type {DisplacementPlacement} from './displacement-placement';
export interface PlacementFace {points:[number[],number[],number[]];color:string;space:'pipe'|'annulus'}
/** Same discrete axial rows as the table. No angular/radial composition is invented. */
export function placementMesh(s:DisplacementPlacement){
 const raw=s.positions.map(p=>new THREE.Vector3(...p)),box=new THREE.Box3().setFromPoints(raw),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),scale=10/Math.max(1,size.length()),points=raw.map(p=>p.clone().sub(center).multiplyScalar(scale)),fr=frames(points);
 const maxRadius=Math.max(...s.rows.map(r=>r.rh)),radialScale=.48/Math.max(.001,maxRadius),faces:PlacementFace[]=[];
 const at=(j:number,r:number,a:number)=>points[j].clone().add(fr.N[j].clone().multiplyScalar(r*Math.cos(a)*radialScale)).add(fr.B[j].clone().multiplyScalar(r*Math.sin(a)*radialScale)).toArray();
 const quad=(a:number[],b:number[],c:number[],d:number[],color:string,space:PlacementFace['space'])=>{faces.push({points:[a,b,c],color,space},{points:[a,c,d],color,space});};
 s.rows.forEach((row,j)=>{
  for(const space of ['annulus','pipe'] as const){
   if(space==='pipe'?!s.pipeEnabled:!s.annulusEnabled)continue;
   const radius=space==='pipe'?row.ri:row.rh,color=space==='pipe'?row.pipeColor:row.annulusColor;
   for(let k=0;k<32;k++){
    // The front half of the annular shell is cut away to expose the pipe.
    if(space==='annulus'&&k<16)continue;
    const a=k*Math.PI/16,b=(k+1)*Math.PI/16;
    quad(at(j,radius,a),at(j+1,radius,a),at(j+1,radius,b),at(j,radius,b),color,space);
   }
  }
 });
 return {faces,centerline:points.map(p=>p.toArray()),radialScale,axialScale:scale};
}
export function placementBufferGeometry(s:DisplacementPlacement){const mesh=placementMesh(s),pos:number[]=[],colors:number[]=[];for(const face of mesh.faces){const color=new THREE.Color(face.color);for(const point of face.points){pos.push(...point);colors.push(color.r,color.g,color.b);}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;}
