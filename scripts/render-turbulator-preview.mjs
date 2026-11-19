import {createServer} from 'vite';
import {writeFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=await createServer({server:{middlewareMode:true}});
try {
 const {default:Inspector}=await server.ssrLoadModule('/src/components/Turbulator3DInspector.tsx');
 const {calculateTurbulatorFlow,defaultTurbulatorDesign}=await server.ssrLoadModule('/src/lib/turbulator-flow.ts');
 const {getCementingExample}=await server.ssrLoadModule('/src/lib/cementing-example.ts');
 const w={...getCementingExample().wellData,casingOD:178,holeDiameter:240,cavernCoeff:1,prevCasingDepth:0,annularStandoffPct:100};
 const result=calculateTurbulatorFlow(w,{id:'a',md:1000,bladesCount:4,bladeAngle:55,bladeHeight:16,bladeWidthMm:15},10,{id:'mud',name:'БР',density:1200,rheology:{pv:25,yp:5}},defaultTurbulatorDesign());
 const html=renderToStaticMarkup(React.createElement(Inspector,{result,pipeOD:178,zenith:25}));
 const svg=html.match(/<svg[\s\S]*?<\/svg>/)[0].replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="900" height="840" ');
 writeFileSync('/tmp/turbulator-actual.svg',svg);
 console.log(JSON.stringify({lengthM:result.lengthM,ratio:result.ratio,valid:result.valid}));
}finally{await server.close();}
