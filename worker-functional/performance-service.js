import {createSourceReadBudget} from './read-budget.js';
import {createSahmtPerformanceSources} from './sahmt-performance-sources.js';
import {createSahmtPerformanceService} from './sahmt-performance-service.js';
import {createSahmtDailyProcessor} from './sahmt-performance-daily.js';
import {isSahmtPerformanceAction} from '../src/sahmt-performance-actions.js';

const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function createFunctionalPerformanceService({store,getAccessToken,authorize,enabled=false,now=Date.now,uuid=()=>crypto.randomUUID()}={}){
 if(!store||typeof getAccessToken!=='function'||typeof authorize!=='function')throw Error('SAHMT_SERVICE_CONFIGURATION_REQUIRED');
 const readBudget=createSourceReadBudget({store});
 const sources=createSahmtPerformanceSources({getAccessToken,readBudget});
 async function authorizeSahmt(identity,manage=false){
  if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.provider!=='custom'||
    !['EQUIPE','ADMINISTRADOR','GESTOR'].includes(identity.functionalGroup))fail('FK_ACCESS_DENIED',401);
  const profile=await authorize(identity);
  if(profile?.uid!==identity.uid||profile.active!==true||profile.access!==true)fail('FK_ACCESS_DENIED',403);
  const canManage=identity.functionalRole==='ADMIN'&&identity.functionalGroup==='ADMINISTRADOR';
  const canRead=canManage||identity.functionalGroup==='EQUIPE'||identity.functionalGroup==='GESTOR'&&identity.functionalPermissions?.includes('performance');
  if(!canRead)fail('FK_PERFORMANCE_ACCESS_DENIED',403);
  if(manage&&!canManage)fail('FK_PERFORMANCE_ADMIN_REQUIRED',403);
  return {canManage};
 }
 const service=createSahmtPerformanceService({store,authorize:authorizeSahmt,now,authorizeTransaction:async(_tx,identity,manage)=>authorizeSahmt(identity,manage)});
 const daily=createSahmtDailyProcessor({store,sources,now,uuid});
 async function execute(action,input,identity){
  if(!isSahmtPerformanceAction(action))fail('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION',404);
  if(!enabled)fail('SAHMT_PERFORMANCE_PREPARING',503);
  return service.execute(action,input,identity);
 }
 async function executeScheduled(body){
  if(body?.action!=='PERFORMANCE'||!exact(body,['action','activity','issuedAt','scheduledTime']))fail('SAHMT_INPUT_INVALID');
  if(!enabled)fail('SAHMT_PERFORMANCE_PREPARING',503);
  return daily.execute(body.scheduledTime,body.activity);
 }
 return Object.freeze({execute,executeScheduled});
}
