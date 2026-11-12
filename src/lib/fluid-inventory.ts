/** Fixed-density FIFO transport. Volumes share one reference condition; no EOS or losses. */
export interface InventoryFluid { fluidId: string; densityGcm3: number; fluidType: 'mud'|'buffer'|'cement'|'displacement' }
export type Parcel<F extends InventoryFluid> = F & { volumeM3: number };
export interface InventoryRow { fluidId:string; fluidType:InventoryFluid['fluidType']; densityKgM3:number; initialM3:number; injectedM3:number; pipeM3:number; annulusM3:number; returnedM3:number; residualM3:number; residualKg:number }
export interface InventorySummary { model:'fixed-density-fifo-v1'; pipeCapacityM3:number; annulusCapacityM3:number; pipeVoidM3:number; injectedM3:number; shoeThroughputM3:number; returnedM3:number; returnedMassKg:number; retainedMassKg:number; maxResidualM3:number; maxResidualKg:number; geometryResidualM3:number; fluids:InventoryRow[] }

export class FluidInventory<F extends InventoryFluid> {
  /** Queues are ordered from outlet to inlet: pipe bottom→top, annulus top→bottom. */
  pipe:Parcel<F>[]=[];
  annulus:Parcel<F>[]=[];
  private initial=new Map<string,number>();
  private injected=new Map<string,number>();
  private returned=new Map<string,number>();
  private fluids=new Map<string,F>();
  shoeThroughputM3=0;
  constructor(readonly pipeCapacityM3:number,readonly annulusCapacityM3:number,mud:F){
    for(const n of [pipeCapacityM3,annulusCapacityM3])if(!Number.isFinite(n)||n<=0)throw new Error('Positive finite inventory capacity required');
    this.register(mud);
    this.pipe=[{...mud,volumeM3:pipeCapacityM3}];this.annulus=[{...mud,volumeM3:annulusCapacityM3}];
    this.initial.set(mud.fluidId,pipeCapacityM3+annulusCapacityM3);
  }
  private register(f:F){
    if(!f.fluidId||!Number.isFinite(f.densityGcm3)||f.densityGcm3<=0)throw new Error('Invalid inventory fluid');
    const old=this.fluids.get(f.fluidId);
    if(old&&(old.densityGcm3!==f.densityGcm3||old.fluidType!==f.fluidType))throw new Error('Fluid ID properties changed inside inventory');
    this.fluids.set(f.fluidId,{...f});
  }
  private amount(v:number){if(!Number.isFinite(v)||v<0)throw new Error('Invalid transport volume');}
  private sum(q:Parcel<F>[]){return q.reduce((n,p)=>n+p.volumeM3,0);}
  get pipeVoidM3(){return Math.max(0,this.pipeCapacityM3-this.sum(this.pipe));}
  private append(q:Parcel<F>[],p:Parcel<F>){
    if(p.volumeM3<=0)return;
    const last=q.at(-1);if(last?.fluidId===p.fluidId)last.volumeM3+=p.volumeM3;else q.push({...p});
  }
  private take(q:Parcel<F>[],volume:number){
    const out:Parcel<F>[]=[];
    while(volume>0&&q.length){const p=q[0],v=Math.min(p.volumeM3,volume);out.push({...p,volumeM3:v});volume-=v;if(v===p.volumeM3)q.shift();else p.volumeM3-=v;}
    return out;
  }
  private toAnnulus(parcels:Parcel<F>[]){
    const shoeM3=this.sum(parcels);for(const p of parcels)this.append(this.annulus,p);
    const returned=this.take(this.annulus,Math.max(0,this.sum(this.annulus)-this.annulusCapacityM3));
    for(const p of returned)this.returned.set(p.fluidId,(this.returned.get(p.fluidId)??0)+p.volumeM3);
    this.shoeThroughputM3+=shoeM3;
    return {shoeM3,returnedM3:this.sum(returned)};
  }
  pump(fluid:F,volumeM3:number){
    this.amount(volumeM3);this.register(fluid);
    this.injected.set(fluid.fluidId,(this.injected.get(fluid.fluidId)??0)+volumeM3);
    this.append(this.pipe,{...fluid,volumeM3});
    return this.toAnnulus(this.take(this.pipe,Math.max(0,this.sum(this.pipe)-this.pipeCapacityM3)));
  }
  freefall(volumeM3:number){this.amount(volumeM3);return this.toAnnulus(this.take(this.pipe,volumeM3));}
  clone(){
    const copy=new FluidInventory(this.pipeCapacityM3,this.annulusCapacityM3,[...this.fluids.values()][0]);
    copy.pipe=this.pipe.map(p=>({...p}));copy.annulus=this.annulus.map(p=>({...p}));
    copy.initial=new Map(this.initial);copy.injected=new Map(this.injected);copy.returned=new Map(this.returned);copy.fluids=new Map(this.fluids);copy.shoeThroughputM3=this.shoeThroughputM3;
    return copy;
  }
  summary():InventorySummary{
    const fluids=[...this.fluids.values()].map(f=>{
      const amount=(q:Parcel<F>[])=>q.filter(p=>p.fluidId===f.fluidId).reduce((n,p)=>n+p.volumeM3,0);
      const initialM3=this.initial.get(f.fluidId)??0,injectedM3=this.injected.get(f.fluidId)??0,pipeM3=amount(this.pipe),annulusM3=amount(this.annulus),returnedM3=this.returned.get(f.fluidId)??0;
      const residualM3=initialM3+injectedM3-pipeM3-annulusM3-returnedM3;
      return {fluidId:f.fluidId,fluidType:f.fluidType,densityKgM3:f.densityGcm3*1000,initialM3,injectedM3,pipeM3,annulusM3,returnedM3,residualM3,residualKg:residualM3*f.densityGcm3*1000};
    });
    return {model:'fixed-density-fifo-v1',pipeCapacityM3:this.pipeCapacityM3,annulusCapacityM3:this.annulusCapacityM3,pipeVoidM3:this.pipeVoidM3,injectedM3:fluids.reduce((n,f)=>n+f.injectedM3,0),shoeThroughputM3:this.shoeThroughputM3,returnedM3:fluids.reduce((n,f)=>n+f.returnedM3,0),returnedMassKg:fluids.reduce((n,f)=>n+f.returnedM3*f.densityKgM3,0),retainedMassKg:fluids.reduce((n,f)=>n+(f.pipeM3+f.annulusM3)*f.densityKgM3,0),maxResidualM3:Math.max(...fluids.map(f=>Math.abs(f.residualM3))),maxResidualKg:Math.max(...fluids.map(f=>Math.abs(f.residualKg))),geometryResidualM3:this.sum(this.pipe)+this.pipeVoidM3+this.sum(this.annulus)-this.pipeCapacityM3-this.annulusCapacityM3,fluids};
  }
}
