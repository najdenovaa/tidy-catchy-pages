import {useMemo,useEffect} from 'react';
import {Canvas} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import type {DisplacementSection} from '@/lib/displacement-section';
export function sectionBufferGeometry(s:DisplacementSection){
 const positions:number[]=[],colors:number[]=[];
 for(const f of s.faces){const color=new THREE.Color(f.color);for(const p of f.points){positions.push(...p.map(x=>x/s.geometry.rh));colors.push(color.r,color.g,color.b);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
function Geometry({data}:{data:DisplacementSection}){const geometry=useMemo(()=>sectionBufferGeometry(data),[data]);useEffect(()=>()=>geometry.dispose(),[geometry]);return <mesh geometry={geometry}><meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false}/></mesh>;}
export default function D2Section3D({data,view}:{data:DisplacementSection;view:'3d'|'top'}){
 return <div className="h-[420px] rounded border bg-white" aria-label="3D-сечение трубы и затрубья"><Canvas key={view} camera={{position:view==='top'?[0,0,4.2]:[1.7,1.9,3.5],fov:35,near:.01,far:100}}><Geometry data={data}/><OrbitControls target={[0,0,0]} enablePan={false}/></Canvas></div>;
}
