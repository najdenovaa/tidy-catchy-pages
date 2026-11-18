/** Preserve established colors; assign deterministic distinct colors to repeated entries. */
export function distinctDisplacementColors(input:string[]){
 const used=new Set<string>();return input.map((original,i)=>{
  let color=original.toLowerCase(),attempt=0;
  while(used.has(color)){
   const h=((i*137.508+attempt++*31)%360)/60,s=.65,l=.48,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2;
   const rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
   color='#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
  }
  used.add(color);return color;
 });
}
export function mixtureColor(fractions:(number|null)[]|null,colors:string[]){
 if(!fractions||fractions.some(v=>v===null||!Number.isFinite(v)))return '#cbd5e1';
 const rgb=new Uint8ClampedArray(3),sum=fractions.reduce((s,v)=>s+(v??0),0);if(!(sum>0))return '#cbd5e1';
 for(let k=0;k<3;k++)rgb[k]=fractions.reduce((s,v,i)=>s+(v??0)*parseInt((colors[i]??'#64748b').slice(1+k*2,3+k*2),16),0)/sum;
 return '#'+Array.from(rgb).map(v=>v.toString(16).padStart(2,'0')).join('');
}
