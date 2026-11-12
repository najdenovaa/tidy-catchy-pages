/** Nested refinement of every interval, including intervals split by an internal boundary. */
export function transportMesh(depth:number,requestedLength:number,boundaryDepth?:number,refinement=1){
 if(!(Number.isFinite(depth)&&depth>0&&requestedLength>=10&&requestedLength<=1000&&Number.isInteger(refinement)&&refinement>=1&&refinement<=16))throw new Error('Недопустимая сетка исследовательского переноса.');
 if(boundaryDepth!==undefined&&!(boundaryDepth>0&&boundaryDepth<=depth))throw new Error('Граница ЦКОД вне колонны.');
 const n=Math.max(2,Math.ceil(depth/requestedLength));
 if(n*refinement*2>120)throw new Error('Сетка с уточнением превышает 120 ячеек. Увеличьте исходную длину.');
 const coarse=[...new Set([...Array.from({length:n+1},(_,i)=>i===n?depth:i*depth/n),...(boundaryDepth===undefined?[]:[boundaryDepth])])].sort((a,b)=>a-b);
 if((coarse.length-1)*refinement*2>120)throw new Error('Сетка с ЦКОД и уточнением превышает 120 ячеек. Увеличьте исходную длину.');
 const cuts=[0];for(let i=1;i<coarse.length;i++)for(let j=1;j<=refinement;j++)cuts.push(j===refinement?coarse[i]:coarse[i-1]+(coarse[i]-coarse[i-1])*j/refinement);
 const lengths=cuts.slice(1).map((b,i)=>b-cuts[i]);
 if(lengths.some(l=>!(l>=1e-6)))throw new Error('У ЦКОД образовалась ячейка короче 1 мкм; измените исходную сетку.');
 return {cuts,pipeCount:cuts.length-1,minLengthM:Math.min(...lengths),maxLengthM:Math.max(...lengths),meanLengthM:depth/(cuts.length-1)};
}
