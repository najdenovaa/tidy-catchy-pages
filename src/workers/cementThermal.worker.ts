import {simulateThermal} from '../lib/cement-thermal';
self.onmessage=e=>{try{self.postMessage({result:simulateThermal(e.data)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};
