import {buildDisplacementInput} from './displacement-2d-input';
import {simulateDisplacement2D} from './displacement-2d';
import {displacementTimeline} from './displacement-pipe';
export interface DisplacementSpacesSettings {fine?:boolean;rotationRpm?:number;settleMin?:number;pipeEnabled?:boolean;annulusEnabled?:boolean}
export function calculateDisplacementSpaces(data:Parameters<typeof buildDisplacementInput>[0],settings:DisplacementSpacesSettings,onProgress?:(f:number)=>void){
 const pipeEnabled=settings.pipeEnabled!==false,annulusEnabled=settings.annulusEnabled!==false;
 if(!pipeEnabled&&!annulusEnabled)throw new Error('Включите хотя бы одно пространство');
 const {input,meta,pipe:boundary}=buildDisplacementInput(data,{annulusEnabled});
 const pipe=pipeEnabled?boundary:null;
 const result=annulusEnabled?simulateDisplacement2D({...input,nZ:settings.fine?Math.round(Math.min(400,Math.max(120,(input.zBot-input.zTop)/2.5))):undefined,nTheta:settings.fine?24:input.nTheta,rotationRpm:settings.rotationRpm,settleMin:settings.settleMin,onProgress}):null;
 const timeline=displacementTimeline(pipe,result,meta.annulusStartS,settings.settleMin??0);
 return {result,pipe,meta,stages:input.stages,timeline};
}
