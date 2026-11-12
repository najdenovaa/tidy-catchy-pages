import {simulateMovingPlug} from './moving-plug';
self.onmessage=e=>{try{self.postMessage({type:'result',result:simulateMovingPlug(e.data)});}catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}};
