import {auth} from './firebase-auth.js';
import {getGoogleProjectAuth,verifyGoogleProjectSession} from './google-project-auth-runtime.js';
import {FF,fail} from '../communication/domain.js';
export const communicationEnabled=import.meta.env.VITE_COMMUNICATION_FF_ENABLED==='true';
const endpoint=import.meta.env.VITE_COMMUNICATION_FF_ENDPOINT||'';
const vapidKey=import.meta.env.VITE_COMMUNICATION_FF_VAPID_KEY||'';
export function createCommunicationClient({isCurrent=()=>true}={}){
 let disposed=false;const controllers=new Set();
 const current=()=>!disposed&&isCurrent()&&document.visibilityState!=='hidden';
 const suspend=()=>{if(document.visibilityState==='hidden')for(const c of controllers)c.abort();};
 document.addEventListener('visibilitychange',suspend);
 async function sessions(){
  if(!communicationEnabled||!current())throw fail('COMM_CONFIG_REQUIRED');
  const source=auth.currentUser;
  if(!source||!await verifyGoogleProjectSession('FF')||!current())throw fail('COMM_SESSION_INVALID');
  const ff=getGoogleProjectAuth('FF');
  if(ff.app.options.projectId!==FF.projectId||ff.app.options.appId!==FF.appId||ff.app.options.messagingSenderId!==FF.senderId)throw fail('COMM_CONFIG_REQUIRED');
  const target=ff.currentUser;
  if(!target||auth.currentUser!==source)throw fail('COMM_SESSION_INVALID');
  return {source,target,ff};
 }
 async function request(action,input={}){
  if(!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/v1\/communication$/.test(endpoint))throw fail('COMM_CONFIG_REQUIRED');
  const {source,target}=await sessions(),controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),60000);
  try{
   const [ffToken,faToken]=await Promise.all([target.getIdToken(),source.getIdToken()]);
   if(!current()||auth.currentUser!==source||getGoogleProjectAuth('FF').currentUser!==target)throw fail('COMM_SESSION_INVALID');
   const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+ffToken,'X-SAHMT-FA-Authorization':'Bearer '+faToken,'Content-Type':'application/json'},body:JSON.stringify({action,input}),cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
   const d=await r.json();if(!r.ok)throw fail(d.code||'COMM_SERVICE_UNAVAILABLE',r.status);
   if(!current()||auth.currentUser!==source||getGoogleProjectAuth('FF').currentUser!==target)throw fail('COMM_SESSION_INVALID');return d;
  }finally{clearTimeout(timer);controllers.delete(controller);}
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
  return request('REGISTER_DEVICE',{token,platform:navigator.userAgentData?.platform||navigator.platform||'Outro'});
 }
 async function disable(){
  const {ff}=await sessions(),{getMessaging,getToken,deleteToken}=await import('firebase/messaging');
  const messaging=getMessaging(ff.app),registration=await navigator.serviceWorker.ready;
  if(Notification.permission==='granted'){
   const token=await getToken(messaging,{vapidKey,serviceWorkerRegistration:registration});
   if(token)await request('DISABLE_DEVICE',{token});
  }
  await deleteToken(messaging);return {registered:false};
 }
 return {request,enable,disable,dispose(){disposed=true;for(const c of controllers)c.abort();document.removeEventListener('visibilitychange',suspend);}};
}
