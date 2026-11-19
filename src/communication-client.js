import {operationalContentAllowed} from './operational-folder-runtime.js';
import {auth} from './firebase-auth.js';
import {getGoogleProjectAuth,waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {FF,fail} from '../communication/domain.js';
import {communicationDevicePushActive,rememberCommunicationDevicePushActive} from './communication-link.js';
import {APP_VERSION} from './app-version.js';
import {deployment} from './deployment-context.js';
import {fcProfessionalRegistrationEnabled} from './fc-integration-config.js';
export const communicationEnabled=import.meta.env.VITE_COMMUNICATION_FF_ENABLED==='true';
const endpoint=import.meta.env.VITE_COMMUNICATION_FF_ENDPOINT||'';
const vapidKey=import.meta.env.VITE_COMMUNICATION_FF_VAPID_KEY||'';
const pushRefreshPeriod=86400000;
const pushRefreshKey=uid=>'sahmt-ff-push-refreshed:'+uid;
const readActions=new Set(['BOOTSTRAP','INBOX','MESSAGE','SENT_MESSAGES','SENT_DETAIL','ACTIVITY_CATALOG','PENDING_ACTIVITIES','MESSAGES','GROUPS','HISTORY','DIRECTORY','PUSH_DEVICE_DIRECTORY','PUSH_TEAM_STATUS','METRICS','SETTINGS','AREAS','AUDIT','USAGE']);
const onFb=()=>typeof deployment!=='undefined'&&deployment.target==='FB';
async function projectSession(target,source,current){
 if(onFb()){
  if(target==='FB')return auth;
  const {restoreCommunicationFbSession}=await import('./communication-fb-session.js');
  return restoreCommunicationFbSession(target,source,current);
 }
 if(!await waitForGoogleProjectSession(target,{isCurrent:current})||!current())return null;
 return getGoogleProjectAuth(target);
}
export async function prepareCommunicationSession({isCurrent=()=>true}={}){
 const current=()=>communicationEnabled&&isCurrent()&&document.visibilityState!=='hidden';
 return current()&&Boolean(await projectSession('FF',auth.currentUser,current))&&current();
}
export function createCommunicationClient({isCurrent=()=>true}={}){
 let disposed=false,presenceReported=false,enrollment;const controllers=new Set(),widgets=new Set(),reads=new Map();
 const current=()=>!disposed&&isCurrent()&&document.visibilityState!=='hidden'&&operationalContentAllowed('comunicacao');
 const suspend=()=>{if(document.visibilityState==='hidden')for(const c of controllers)c.abort();};
 document.addEventListener('visibilitychange',suspend);
 async function sessions(){
  if(!communicationEnabled||!current())throw fail('COMM_CONFIG_REQUIRED');
  const source=auth.currentUser;
  const ff=source&&await projectSession('FF',source,current);
  if(!ff||!current())throw fail('COMM_SESSION_INVALID');
  if(ff.app.options.projectId!==FF.projectId||ff.app.options.appId!==FF.appId||ff.app.options.messagingSenderId!==FF.senderId)throw fail('COMM_CONFIG_REQUIRED');
  const target=ff.currentUser;
  if(!target||auth.currentUser!==source)throw fail('COMM_SESSION_INVALID');
  return {source,target,ff};
 }
 async function performRequest(action,input={}, {activityKind}={}){
  if(!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/v1\/communication$/.test(endpoint))throw fail('COMM_CONFIG_REQUIRED');
  const {source,target,ff}=await sessions(),controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),60000);
  try{
   const ffToken=await target.getIdToken();
   const headers={Authorization:'Bearer '+ffToken,'Content-Type':'application/json'};
   if(action==='SCHEDULE_RELEASE_NOTICE')headers['X-SAHMT-FA-Authorization']='Bearer '+await source.getIdToken();
   if(['ACTIVITY_CATALOG','PREVIEW_ACTIVITY','CREATE_ACTIVITY','VERIFY_ACTIVITY'].includes(action)){
    const kind=input.kind||input.activity?.kind||activityKind;
    const projects=kind==='TRAINING'?['FB']:kind==='SURVEY'?['FA']:['FA','FB'];
    if(kind!=='TRAINING'&&fcProfessionalRegistrationEnabled)projects.push('FC');
    for(const project of projects){
     const primary=onFb()?'FB':'FA';
     const sourceUser=project===primary?source:(await projectSession(project,source,current))?.currentUser;
     if(sourceUser)headers['X-SAHMT-'+project+'-Authorization']='Bearer '+await sourceUser.getIdToken();
    }
   }
   const includePresence=!presenceReported&&['BOOTSTRAP','INBOX','REGISTER_DEVICE'].includes(action);
   if(includePresence){
    try{
     const {installationId,appDisplayMode,devicePlatform}=await import('./app-updates-targeted.js');
     const displayMode=appDisplayMode(),deviceId=installationId(localStorage,globalThis.crypto,displayMode);
     input={...input,installation:{deviceId,displayMode,platform:devicePlatform(),appVersion:APP_VERSION,loadedRelease:Number(import.meta.env.VITE_APP_RELEASE)||0}};
    }catch{}
   }
   if(!current()||auth.currentUser!==source||ff.currentUser!==target)throw fail('COMM_SESSION_INVALID');
   const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({action,input}),cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
   const d=await r.json();if(!r.ok){const error=fail(d.code||'COMM_SERVICE_UNAVAILABLE',r.status);for(const key of ['used','limit','resetsAt'])if(Number.isSafeInteger(d[key])&&d[key]>=0)error[key]=d[key];throw error;}
   if(!current()||auth.currentUser!==source||ff.currentUser!==target)throw fail('COMM_SESSION_INVALID');if(input.installation)presenceReported=true;return d;
  }finally{clearTimeout(timer);controllers.delete(controller);}
 }
 function request(action,input={},options){
  if(!readActions.has(action))return performRequest(action,input,options);
  if(!current())return Promise.reject(fail('COMM_CONFIG_REQUIRED'));
  const key=JSON.stringify([action,input]),source=auth.currentUser,previous=reads.get(key);
  if(previous&&previous.source===source)return previous.promise;
  const entry={source,promise:performRequest(action,input)};
  reads.set(key,entry);
  void entry.promise.finally(()=>{if(reads.get(key)===entry)reads.delete(key);}).catch(()=>{});
  return entry.promise;
 }
 async function registerPush(permissionPromise){
  if(!('serviceWorker'in navigator)||!('Notification'in window)||!vapidKey)throw fail('COMM_PUSH_UNSUPPORTED');
  if(await permissionPromise!=='granted')throw fail('COMM_PUSH_PERMISSION');
  const {ff,source}=await sessions();
  const {getMessaging,getToken,isSupported}=await import('firebase/messaging');
  if(!await isSupported())throw fail('COMM_PUSH_UNSUPPORTED');
  const registration=await navigator.serviceWorker.ready;
  if(new URL(registration.scope).pathname!==import.meta.env.BASE_URL)throw fail('COMM_PUSH_UNSUPPORTED');
  const token=await getToken(getMessaging(ff.app),{vapidKey,serviceWorkerRegistration:registration});
  const {installationId,appDisplayMode,devicePlatform}=await import('./app-updates-targeted.js');
  const displayMode=appDisplayMode(),deviceId=installationId(localStorage,globalThis.crypto,displayMode);
  if(!current()||auth.currentUser!==source)throw fail('COMM_SESSION_INVALID');
  const result=await request('REGISTER_DEVICE',{token,deviceId,displayMode,platform:devicePlatform()});
  rememberCommunicationDevicePushActive(true);
  try{localStorage.setItem(pushRefreshKey(source.uid),String(Date.now()));}catch{}
  return result;
 }
 function enable(permissionPromise){
  if(!enrollment)enrollment=registerPush(permissionPromise).finally(()=>{enrollment=undefined;});
  return enrollment;
 }
 async function refreshPushRegistration(){
  const uid=auth.currentUser?.uid;
  if(!uid||!current()||!vapidKey||!communicationDevicePushActive())return;
  try{
   const refreshed=Number(localStorage.getItem(pushRefreshKey(uid)));
   if(refreshed>0&&Date.now()-refreshed<pushRefreshPeriod)return;
  }catch{}
  return enable(Promise.resolve('granted'));
 }
 async function disable(){
  const {ff}=await sessions(),{getMessaging,getToken,deleteToken}=await import('firebase/messaging');
  const messaging=getMessaging(ff.app),registration=await navigator.serviceWorker.ready;
  if(Notification.permission==='granted'){
   const token=await getToken(messaging,{vapidKey,serviceWorkerRegistration:registration});
   if(token)await request('DISABLE_DEVICE',{token});
  }
  rememberCommunicationDevicePushActive(false);
  await deleteToken(messaging);return {registered:false};
 }
 async function connectGoogle(host,{onConnected,onError}){
  const live=()=>!disposed&&isCurrent()&&host.isConnected;
  if(!live())return()=>{};
  const link=document.createElement('a');link.href='#/offline';link.textContent='RECUPERAR ACESSO NA ENTRADA DO SAHMT';
  const widget={dispose:()=>link.remove()};
  widgets.add(widget);
  const cleanup=()=>{widget.dispose();widgets.delete(widget);};
  host.replaceChildren(link);
  return cleanup;
 }
 return {request,enable,disable,refreshPushRegistration,connectGoogle,dispose(){disposed=true;reads.clear();for(const c of controllers)c.abort();for(const w of widgets)w.dispose();widgets.clear();document.removeEventListener('visibilitychange',suspend);}};
}
