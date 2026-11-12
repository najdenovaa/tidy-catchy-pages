import {it,expect} from 'vitest';
import {initializeFlow,advanceFlow,mixtureDensity,type FlowSystem} from './compressible-flow';
const system=(bulk=2000):FlowSystem=>({referenceMPa:0,outletMPa:1,inletTvd:0,outletTvd:0,fluids:[{id:'mud',name:'Mud',rhoRef:1100,bulkMPa:bulk,pv:10,yp:0},{id:'buffer',name:'Buffer',rhoRef:1200,bulkMPa:bulk,pv:15,yp:0}],cells:Array.from({length:6},(_,i)=>({volumeM3:Math.PI*.1*.1*10,lengthM:10,tvd:0,kind:'pipe' as const,outerMm:220,innerMm:200,md:(i+.5)*10}))});
it('preserves hydrostatic equilibrium at zero injection',()=>{
 const s=system();s.cells=s.cells.map((c,i)=>({...c,tvd:i<3?(i+.5)*10:(5.5-i)*10}));s.inletTvd=0;s.outletTvd=0;
 const initial=initializeFlow(s,0),step=advanceFlow(s,initial,10,0,0);expect(step.state.pressures).toEqual(initial.pressures);expect(step.maxComponentResidualKg).toBeLessThan(1e-6);expect(Math.abs(step.fluxKgS.at(-1))).toBeLessThan(1e-7);
});
it('couples pressure/storage/returns and closes each component over changing injection',()=>{
 const s=system(),initial=initializeFlow(s,0);let state=initial;const injected=[0,0],returned=[0,0];
 for(let i=0;i<12;i++){const fluid=i<4?0:1,rate=i<6?2:3,dt=5;const step=advanceFlow(s,state,dt,rate,fluid);state=step.state;injected[fluid]+=rate*dt;step.returnedKg.forEach((v,j)=>returned[j]+=v);expect(step.maxRelativeResidual).toBeLessThan(1e-7);expect(step.inletMPa).toBeGreaterThan(1);}
 for(let j=0;j<2;j++){const initialMass=initial.masses.reduce((n,m,i)=>n+m*initial.fractions[i][j],0),finalMass=state.masses.reduce((n,m,i)=>n+m*state.fractions[i][j],0);expect(Math.abs(initialMass+injected[j]-returned[j]-finalMass)).toBeLessThan(.001);}
 expect(state.fractions.some(f=>f[1]>0)).toBe(true);expect(returned[0]).toBeGreaterThan(0);
});
it('uses harmonic mixture EOS and rejects invalid pressure range',()=>{
 const s=system();expect(mixtureDensity(s.fluids,[.5,.5],0,0).rho).toBeCloseTo(1/(.5/1100+.5/1200),9);expect(()=>mixtureDensity(s.fluids,[1,0],300,0)).toThrow(/10%/);expect(()=>advanceFlow(s,initializeFlow(s,0),0,1,0)).toThrow();
});

it('starts and pauses a yield-stress fluid without inventing flow below yield',()=>{
 const s=system();s.fluids=s.fluids.map(f=>({...f,yp:2}));const initial=initializeFlow(s,0),a=advanceFlow(s,initial,5,2,0);expect(a.inletMPa).toBeGreaterThan(s.outletMPa);const b=advanceFlow(s,a.state,5,0,0);expect(b.maxRelativeResidual).toBeLessThan(1e-7);expect(b.fluxKgS.at(-1)).toBeGreaterThanOrEqual(-1e-7);
});

it('matches the independent isothermal compressible Poiseuille steady limit',()=>{
 const s=system(),initial=initializeFlow(s,0);let state=initial,last=advanceFlow(s,state,10,2,0);for(let i=0;i<10;i++){last=advanceFlow(s,last.state,10,2,0);}
 const bulkPa=2000e6,mu=.01,massRate=2,diameter=.2,length=60;
 const expected=2000*Math.log(Math.exp(1/2000)+128*mu*length*massRate/(Math.PI*diameter**4*bulkPa*1100));
 expect(last.inletMPa).toBeCloseTo(expected,7);expect(last.fluxKgS.at(-1)).toBeCloseTo(2,6);
});
it('reducing the time step improves the implicit-upwind tracer solution',()=>{
 const s=system();s.fluids[1]={...s.fluids[0],id:'tracer',name:'Tracer'};
 const warm=advanceFlow(s,initializeFlow(s,0),10,2,0).state,T=100;
 const run=(dt:number)=>{let state=warm;for(let t=0;t<T;t+=dt)state=advanceFlow(s,state,dt,2,1).state;return state.fractions[0][1];};
 const exact=1-Math.exp(-2*T/warm.masses[0]);expect(Math.abs(run(5)-exact)).toBeLessThan(Math.abs(run(10)-exact));
});
