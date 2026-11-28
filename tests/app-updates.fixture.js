import {installAppUpdatePrompt} from '../src/app-updates.js';
import '../src/app-updates.css';
import {mountCommunicationObligationBanner} from '../src/communication-obligation-banner.js';
import {mountManagementHub} from '../src/management-hub.js';

const registration=Object.assign(new EventTarget(),{waiting:null,installing:null,async update(){window.updateChecks++;}});
const serviceWorker={controller:{state:'activated'},async register(){return registration;}};
window.repairAccepted=true;window.updateChecks=0;window.repairs=[];window.indicatorCalls=[];window.indicatorFailure=false;window.deferIndicators=false;window.apiSignal=null;
let cleanup;
window.openHub=(access=true)=>{
 cleanup?.();
 cleanup=mountManagementHub(document.querySelector('#root'),{access:{results:access,sahmtPerformance:access},performanceUid:'member',isSurveySessionCurrent:()=>true,onExit:()=>cleanup?.(),performIndicators:async(action,input,signal)=>{
  window.apiSignal=signal;window.indicatorCalls.push({action,input});
  if(window.deferIndicators)await new Promise(resolve=>window.resolveIndicators=resolve);
  if(window.indicatorFailure)throw Object.assign(Error('NOT_AUTHORIZED'),{status:403});
  return {status:'READY',uid:'member',batchId:'2026-12-01_02',cutoff:1796101200000,updatedAt:1796101201000,canManage:false,summary:{total:10,percentage:100,byCategory:{OPERATIONS:10,MANAGEMENT:0,RECORDS:0,SURVEYS:0,NOTIFICATIONS:0,CONTINUING_EDUCATION:0}}};
 }});
};
window.closeHub=()=>cleanup?.();
document.querySelector('#open-hub').addEventListener('click',()=>window.openHub());
window.offerUpdate=()=>{registration.waiting=Object.assign(new EventTarget(),{state:'installed'});registration.dispatchEvent(new Event('updatefound'));};
window.updates=await installAppUpdatePrompt({base:'/SAHMT-V2.0.github.io/',target:'FA',serviceWorker,repair:options=>{window.repairs.push(options);return window.repairAccepted;}});
window.openRequiredActivity=()=>{
 const publishAt=1700000000000,dueAt=publishAt+3600000;
 const activity={id:'activity-test',publishAt,dueAt,activity:{kind:'SURVEY',id:'epidemiological',title:'Cadastro Epidemiológico',cycle:'2026'}};
 window.obligationOpenCount=0;
 return mountCommunicationObligationBanner({uid:'member',client:{async request(action){
  return action==='PENDING_ACTIVITIES'?{items:[activity],serverNow:dueAt}:{completed:false,serverNow:dueAt};
 }},onOpenActivity:()=>{window.obligationOpenCount++;}});
};
window.fixtureReady=true;
