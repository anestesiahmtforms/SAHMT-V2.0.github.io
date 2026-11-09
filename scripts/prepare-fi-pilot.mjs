import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFiStore,FI_PROJECTS} from '../worker-fi-control/store.js';
import {createFiSourceProvider,SOURCE_COLLECTIONS} from '../worker-fi-control/sources.js';

const operator='anestesiahmtforms@gmail.com';
const owners={FA:operator,FI:'anestesiahmtforms9@gmail.com',FC:'anestesiahmtforms3@gmail.com'};
const demand=(value,code)=>{if(!value)throw Error(code);};
async function ownerStore(alias){
 const token=await firebaseCliAccountToken(owners[alias]);
 return createFiStore({projectId:FI_PROJECTS[alias],getAccessToken:async()=>token,
  ...(alias==='FI'?{}:{readOnly:true,allowedCollections:SOURCE_COLLECTIONS[alias]})});
}
try{
 const [fa,fi,fc]=await Promise.all(['FA','FI','FC'].map(ownerStore));
 const profiles=await fa.list('users',[{field:'email',op:'EQUAL',value:operator}],3);
 demand(profiles.length===1,'FI_PILOT_OPERATOR_AMBIGUOUS');
 const profile=profiles[0];
 const isAdmin=p=>p?.active===true&&p.access===true&&(p.role==='administrador_app'||p.permissions?.admin===true);
 demand(profile.id===profile.uid&&profile.email===operator&&isAdmin(profile),'FI_PILOT_OPERATOR_DENIED');
 const [link,managed,runtime]=await fi.getMany([['fiAdminIdentityLinks',profile.uid],['fiAdminUsers',profile.uid],['fiControlConfig','runtime']]);
 demand(link?.active===true&&link.faUid===profile.uid&&link.email===operator&&isAdmin(managed)&&runtime?.enabled===true&&runtime.monthlyBudgetMicros===0,'FI_PILOT_FI_DENIED');
 const sources=createFiSourceProvider({stores:{FC:fc}});
 const actor={uid:profile.uid,email:operator,profile:managed};
 const units=await sources.monthlyAccess(actor);
 demand(units.length>0,'FI_PILOT_FC_DENIED');
 const today=new Date(),prior=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1)).toISOString().slice(0,7);
 const snapshot=await sources.monthlySnapshot(actor,prior);
 const now=Date.now(),budget=250000,period=7*86400000;
 const result=await fi.transaction(async tx=>{
  const existing=await tx.get('fiControlConfig','pilot');
  if(existing){
   demand(existing.schemaVersion===1&&existing.uid===profile.uid&&existing.monthlyBudgetMicros===budget&&existing.expiresAt>now,'FI_PILOT_EXISTING_CONFIG_REVIEW');
   return existing;
  }
  const next={schemaVersion:1,uid:profile.uid,createdAt:now,expiresAt:now+period,monthlyBudgetMicros:budget};
  tx.create('fiControlConfig','pilot',next);
  return next;
 });
 const persisted=await fi.get('fiControlConfig','pilot');
 demand(persisted?.uid===profile.uid&&persisted.expiresAt===result.expiresAt&&persisted.monthlyBudgetMicros===budget,'FI_PILOT_READBACK_FAILED');
 console.log(JSON.stringify({pilotPrepared:true,eligibleAccounts:1,budgetUsd:budget/1000000,expiresAt:new Date(result.expiresAt).toISOString(),mostRecentPeriod:prior,monthlyDataComplete:snapshot.complete,validIndicatorCount:snapshot.indicators.length}));
}catch(error){
 console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'FI_PILOT_PREPARE_FAILED'}));
 process.exitCode=1;
}
