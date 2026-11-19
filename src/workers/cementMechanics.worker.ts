import {calculateMechanics} from '../lib/cement-mechanics';
self.onmessage=e=>{try{self.postMessage({result:calculateMechanics(e.data.input,e.data.thermal)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};
