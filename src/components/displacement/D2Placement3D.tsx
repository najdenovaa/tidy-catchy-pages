import {Component,useEffect,useMemo,type ReactNode} from 'react';
import {Canvas} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import {placementBufferGeometry} from '@/lib/displacement-placement-mesh';
import type {DisplacementPlacement} from '@/lib/displacement-placement';
class SceneBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}render(){return this.state.failed?this.props.fallback:this.props.children;}}
function Geometry({data}:{data:DisplacementPlacement}){const geometry=useMemo(()=>placementBufferGeometry(data),[data]);useEffect(()=>()=>geometry.dispose(),[geometry]);return <mesh geometry={geometry}><meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false}/></mesh>;}
export default function D2Placement3D({data,fallback}:{data:DisplacementPlacement;fallback:ReactNode}){return <SceneBoundary fallback={fallback}><div className="h-[480px] rounded border overflow-hidden" aria-label="Общая 3D-скважина с жидкостями"><Canvas camera={{position:[10,4,12],fov:45,near:.01,far:100}}><color attach="background" args={['#f8fafc']}/><Geometry data={data}/><OrbitControls target={[0,0,0]} enablePan/></Canvas></div></SceneBoundary>;}
