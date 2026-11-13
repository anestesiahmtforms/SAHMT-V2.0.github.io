import {operationalContentAllowed} from './operational-folder-runtime.js';
import {auth} from './firebase-auth.js';
import {getGoogleProjectAuth,waitForGoogleProjectSession} from './google-project-auth-runtime.js';
import {FF,fail} from '../communication/domain.js';
import {rememberCommunicationDevicePushActive} from './communication-link.js';
import {APP_VERSION} from './app-version.js';
export const communicationEnabled=import.meta.env.VITE_COMMUNICATION_FF_ENABLED==='true';
const endpoint=import.meta.env.VITE_COMMUNICATION_FF_ENDPOINT||'';
const vapidKey=import.meta.env.VITE_COMMUNICATION_FF_VAPID_KEY||'';
const readActions=new Set(['BOOTSTRAP','INBOX','MESSAGE','MESSAGES','GROUPS','HISTORY','DIRECTORY','PUSH_DEVICE_DIRECTORY','METRICS','SETTINGS','AREAS','AUDIT','USAGE']);
export async function prepareCommunicationSession({isCurrent=()=>true}={}){
 const current=()=>communicationEnabled&&isCurrent()&&document.visibilityState!=='hidden';
 return current()&&await waitForGoogleProjectSession('FF',{isCurrent:current})&&current();
}
export function createCommunicationClient({isCurrent=()=>true}={}){
 let disposed=false,presenceReported=false;const controllers=new Set(),widgets=new Set(),reads=new Map();
 const current=()=>!disposed&&isCurrent()&&document.visibilityState!=='hidden'&&operationalContentAllowed('comunicacao');
 const suspend=()=>{if(document.visibilityState==='hidden')for(const c of controllers)c.abort();};
 document.addEventListener('visibilitychange',suspend);
 async function sessions(){
  if(!communicationEnabled||!current())throw fail('COMM_CONFIG_REQUIRED');
  const source=auth.currentUser;
  if(!source||!await prepareCommunicationSession({isCurrent:current})||!current())throw fail('COMM_SESSION_INVALID');
  const ff=getGoogleProjectAuth('FF');
  if(ff.app.options.projectId!==FF.projectId||ff.app.options.appId!==FF.appId||ff.app.options.messagingSenderId!==FF.senderId)throw fail('COMM_CONFIG_REQUIRED');
  const target=ff.currentUser;
  if(!target||auth.currentUser!==source)throw fail('COMM_SESSION_INVALID');
  return {source,target,ff};
 }
 async function performRequest(action,input={}){
  if(!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/v1\/communication$/.test(endpoint))throw fail('COMM_CONFIG_REQUIRED');
  const {source,target}=await sessions(),controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),60000);
  try{
   const ffToken=await target.getIdToken();
   const headers={Authorization:'Bearer '+ffToken,'Content-Type':'application/json'};
   if(action==='SCHEDULE_RELEASE_NOTICE')headers['X-SAHMT-FA-Authorization']='Bearer '+await source.getIdToken();
   if(!presenceReported&&['BOOTSTRAP','INBOX','REGISTER_DEVICE'].includes(action)){
    try{const {installationId,appDisplayMode,devicePlatform}=await import('./app-updates-targeted.js');const displayMode=appDisplayMode();input={...input,installation:{deviceId:installationId(localStorage,globalThis.crypto,displayMode),displayMode,platform:devicePlatform(),appVersion:APP_VERSION,loadedRelease:Number(import.meta.env.VITE_APP_RELEASE)||0}};}catch{}
   }
   if(!current()||auth.currentUser!==source||getGoogleProjectAuth('FF').currentUser!==target)throw fail('COMM_SESSION_INVALID');
   const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({action,input}),cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
   const d=await r.json();if(!r.ok){const error=fail(d.code||'COMM_SERVICE_UNAVAILABLE',r.status);for(const key of ['used','limit','resetsAt'])if(Number.isSafeInteger(d[key])&&d[key]>=0)error[key]=d[key];throw error;}
   if(!current()||auth.currentUser!==source||getGoogleProjectAuth('FF').currentUser!==target)throw fail('COMM_SESSION_INVALID');if(input.installation)presenceReported=true;return d;
  }finally{clearTimeout(timer);controllers.delete(controller);}
 }
 function request(action,input={}){
  if(!readActions.has(action))return performRequest(action,input);
  if(!current())return Promise.reject(fail('COMM_CONFIG_REQUIRED'));
  const key=JSON.stringify([action,input]),source=auth.currentUser,previous=reads.get(key);
  if(previous&&previous.source===source)return previous.promise;
  const entry={source,promise:performRequest(action,input)};
  reads.set(key,entry);
  void entry.promise.finally(()=>{if(reads.get(key)===entry)reads.delete(key);}).catch(()=>{});
  return entry.promise;
 }
 async function enable(permissionPromise){
  if(!('serviceWorker'in navigator)||!('Notification'in window)||!vapidKey)throw fail('COMM_PUSH_UNSUPPORTED');
  if(await permissionPromise!=='granted')throw fail('COMM_PUSH_PERMISSION');
  const {ff}=await sessions();
  const {getMessaging,getToken,isSupported}=await import('firebase/messaging');
  if(!await isSupported())throw fail('COMM_PUSH_UNSUPPORTED');
  const registration=await navigator.serviceWorker.ready;
  if(new URL(registration.scope).pathname!==import.meta.env.BASE_URL)throw fail('COMM_PUSH_UNSUPPORTED');
  const token=await getToken(getMessaging(ff.app),{vapidKey,serviceWorkerRegistration:registration});
  const {installationId,appDisplayMode,devicePlatform}=await import('./app-updates-targeted.js');
  const displayMode=appDisplayMode(),deviceId=installationId(localStorage,globalThis.crypto,displayMode);
  const result=await request('REGISTER_DEVICE',{token,deviceId,displayMode,platform:devicePlatform()});
  rememberCommunicationDevicePushActive(true);
  return result;
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
 return {request,enable,disable,connectGoogle,dispose(){disposed=true;reads.clear();for(const c of controllers)c.abort();for(const w of widgets)w.dispose();widgets.clear();document.removeEventListener('visibilitychange',suspend);}};
}
