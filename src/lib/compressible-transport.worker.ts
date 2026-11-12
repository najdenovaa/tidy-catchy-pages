import {simulateCompressibleTransport} from './compressible-transport';
self.onmessage=event=>{
 try{const result=simulateCompressibleTransport(event.data,fraction=>self.postMessage({type:'progress',fraction}));self.postMessage({type:'result',result});}
 catch(e){self.postMessage({type:'error',message:e instanceof Error?e.message:String(e)});}
};
