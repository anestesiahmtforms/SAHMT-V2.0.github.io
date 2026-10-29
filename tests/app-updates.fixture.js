import {installAppUpdatePrompt} from '../src/app-updates.js';
import '../src/app-updates.css';
import {mountManagementHub} from '../src/management-hub.js';

const registration=Object.assign(new EventTarget(),{waiting:null,installing:null,async update(){window.updateChecks++;}});
const serviceWorker={controller:{state:'activated'},async register(){return registration;}};
window.repairAccepted=true;window.updateChecks=0;window.repairs=[];window.indicatorCalls=[];window.indicatorFailure=false;window.deferIndicators=false;window.apiSignal=null;
let cleanup;
window.openHub=(access=true)=>{
 cleanup?.();
 cleanup=mountManagementHub(document.querySelector('#root'),{access:{results:access},isSurveySessionCurrent:()=>true,onExit:()=>cleanup?.(),performIndicators:async(action,input,signal)=>{
  window.apiSignal=signal;window.indicatorCalls.push({action,input});
  if(window.deferIndicators)await new Promise(resolve=>window.resolveIndicators=resolve);
  if(window.indicatorFailure)throw Object.assign(Error('NOT_AUTHORIZED'),{status:403});
  return {schemaVersion:1,year:input.year,canManage:false,metrics:[{id:'example',platform:'management',title:'Indicador demonstrativo',unit:'%',months:[{month:1,status:'VALID',value:100}],quarters:[]}],connectionStatus:{management:'READY'},reviews:[],actions:[],asOf:'2026-10-29'};
 }});
};
window.closeHub=()=>cleanup?.();
document.querySelector('#open-hub').addEventListener('click',()=>window.openHub());
window.offerUpdate=()=>{registration.waiting=Object.assign(new EventTarget(),{state:'installed'});registration.dispatchEvent(new Event('updatefound'));};
window.updates=await installAppUpdatePrompt({base:'/SAHMT-V2.0.github.io/',target:'FA',serviceWorker,repair:options=>{window.repairs.push(options);return window.repairAccepted;}});
window.fixtureReady=true;
