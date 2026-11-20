import {it,expect} from 'vitest';
import {turbulatorAnimationTrack} from './turbulator-animation-track';
import type {FlowTracePoint} from './turbulator-streamlines';
it('uses one physical clock across camera occlusion boundaries and preserves nonuniform travel time',()=>{
 const trace:FlowTracePoint[]=[{mean:[0,0,0],particle:[0,0,0],travelS:0,physicalPhase:0},{mean:[1,0,1],particle:[1,0,1],travelS:1,physicalPhase:1},{mean:[1,2,2],particle:[1,2,2],travelS:4,physicalPhase:2}];
 const track=turbulatorAnimationTrack(trace,v=>[v[0],v[2]],v=>v[2]<1.5)!;
 expect(track.seconds).toBe(4);
 expect(track.keyTimes.split(';').map(Number)).toEqual([0,.25,1]);
 expect(track.frontOpacity).toBe('1;1;0');expect(track.backOpacity).toBe('0;0;1');
 expect(track.path.split(' L ')).toHaveLength(3);
 const fast=turbulatorAnimationTrack(trace.map(p=>({...p,travelS:p.travelS/2})),v=>[v[0],v[2]],v=>v[2]<1.5)!;
 expect(fast.path).toBe(track.path);expect(fast.seconds).toBe(track.seconds/2);
 expect(fast.keyPoints).toBe(track.keyPoints);
});
