import {createSahmtPerformanceService} from './sahmt-performance-service.js';
import {createSahmtDailyProcessor} from './sahmt-performance-daily.js';
import {isSahmtPerformanceAction} from '../src/sahmt-performance-actions.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function createIndicatorService({store,performanceSources=null,now=Date.now,uuid=()=>crypto.randomUUID(),sahmtEnabled=false}={}){
 const admin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
 function validateSahmtProfile(p,identity,manage){
  if(p?.uid!==identity.uid||p.email?.trim().toLowerCase()!==identity.email.trim().toLowerCase()||p.active!==true||p.access!==true)fail('INDICATOR_FORBIDDEN',403);
  const canManage=admin(p);if(manage&&!canManage)fail('INDICATOR_FORBIDDEN',403);
  return {canManage};
 }
 async function authorizeSahmt(identity,manage=false){
  if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.provider!=='google.com'||identity.emailVerified!==true||typeof identity.email!=='string')fail('INDICATOR_UNAUTHENTICATED',401);
  return validateSahmtProfile(await store.get('users',identity.uid),identity,manage);
 }
 const consolidated=createSahmtPerformanceService({store,authorize:authorizeSahmt,now,authorizeTransaction:async(tx,identity,manage)=>validateSahmtProfile(await tx.get('users',identity.uid),identity,manage)});
 const daily=createSahmtDailyProcessor({store,sources:performanceSources,now,uuid});

 async function execute(action,input,identity){
  if(!isSahmtPerformanceAction(action))fail('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION',404);
  if(!sahmtEnabled)fail('SAHMT_PERFORMANCE_PREPARING',503);
  return consolidated.execute(action,input,identity);
 }
 async function executeScheduled(body){
  if(body?.action!=='PERFORMANCE')fail('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION',404);
  if(!sahmtEnabled)fail('SAHMT_PERFORMANCE_PREPARING',503);
  if(!exact(body,['action','activity','issuedAt','scheduledTime']))fail('SAHMT_INPUT_INVALID');
  return daily.execute(body.scheduledTime,body.activity);
 }
 return {execute,executeScheduled};
}
