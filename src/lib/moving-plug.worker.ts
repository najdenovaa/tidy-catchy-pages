import {evaluatePlugBench} from './plug-bench';
self.onmessage=e=>{try{const result=evaluatePlugBench(e.data);if(!result)throw new Error('Не задан случай стенда.');self.postMessage({type:'result',result});}catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}};
