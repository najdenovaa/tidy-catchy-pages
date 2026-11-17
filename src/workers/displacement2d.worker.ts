/// <reference lib="webworker" />
import {calculateDisplacementSpaces,type DisplacementSpacesSettings} from '@/lib/displacement-spaces';
import type {buildDisplacementInput} from '@/lib/displacement-2d-input';
type Msg={id:number;data:Parameters<typeof buildDisplacementInput>[0]}&DisplacementSpacesSettings;
self.onmessage=(e:MessageEvent<Msg>)=>{
 const{id,data,...settings}=e.data;
 try{
  let last=0;
  const result=calculateDisplacementSpaces(data,settings,f=>{const now=Date.now();if(now-last>150){last=now;(self as unknown as Worker).postMessage({id,progress:f});}});
  (self as unknown as Worker).postMessage({id,...result});
 }catch(err){(self as unknown as Worker).postMessage({id,error:String((err as Error)?.message??err)});}
};
