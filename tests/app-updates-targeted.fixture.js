import {installTargetedAppUpdates} from '../src/app-updates-targeted.js';
import {openAppUpdatePanel} from '../src/app-updates-targeted-admin.js';
import '../src/app-updates-targeted.css';
const params=new URLSearchParams(location.search),target=params.get('target')||'FA';
async function api(action,input={}) {
  const response=await fetch('/__targeted-updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,action,...input})});
  if(!response.ok)throw Error('unavailable');return response.json();
}
const services={
  recordAppInstallation:async value=>{await api('record',{value});window.savedDevice=value;},
  listAppUpdateUsers:()=>api('users'),
  readUserAppUpdates:(_,uid)=>api('read',{uid}),
  watchAppInstallations:(_,uid,onData,onError)=>{let stopped=false,running=false;window.fixtureSubscriptions=(window.fixtureSubscriptions||0)+1;const read=async()=>{if(stopped||running)return;running=true;try{const result=await api('read',{uid});if(!stopped)onData(result.devices);}catch(error){if(!stopped)onError(error);}finally{running=false;}};const timer=setInterval(read,120);void read();return()=>{if(stopped)return;stopped=true;clearInterval(timer);window.fixtureSubscriptions--;};},
  requestUserAppUpdate:async(_,uid,minimumRelease)=>{await api('request',{uids:[uid],minimumRelease});window.individualRequests=(window.individualRequests||0)+1;},
  cancelUserAppUpdate:(_,uid)=>api('cancel',{uid}),
  sendAppUpdateBatch:(_,uids,minimumRelease)=>api('request',{uids,minimumRelease})
};
window.repairs=[];
const controller=installTargetedAppUpdates({target,release:Number(params.get('release')||200),services:async()=>services,repair:value=>{window.repairs.push(value);return false;},signOut:()=>controller.setSession({status:'signed-out'})});
window.openSession=async uid=>{
  const snapshot=await api('read',{uid});
  controller.setSession({status:'signed-in',user:{uid},profile:{uid,appUpdateRequest:snapshot.request},offline:false});
};
document.querySelector('#open-command').onclick=()=>openAppUpdatePanel({actorUid:'admin',target,isCurrent:()=>true,services,readRelease:async()=>200});
window.targetedReady=true;
