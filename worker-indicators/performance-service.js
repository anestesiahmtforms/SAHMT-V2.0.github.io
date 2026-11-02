import {METRICS} from '../indicators-platform/domain/catalog.js';

const PROJECT='rotinas-8a617';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const validText=value=>typeof value==='string'&&value.trim().length>=8&&value.length<=2000&&
 !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)&&
 !/(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|https?:\/\/|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b(?:\+55\s*)?\(?\d{2}\)?[ -]?\d{4,5}[ -]?\d{4}\b)/i.test(value);

export function createFdPerformanceService({store,authorize,freshTransaction,now=Date.now}={}){
 if(!store?.get||!store?.list||!store?.transaction||typeof authorize!=='function'||typeof freshTransaction!=='function')throw Error('FD_PERFORMANCE_CONFIG_INVALID');
 const currentYear=()=>Number(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric'}).format(now()));
 const runtimeFrom=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
 async function runtime(tx){
  const value=await (tx?tx.get('fdPerformanceRuntime','current'):store.get('fdPerformanceRuntime','current'));
  if(!value||value.schemaVersion!==1||value.projectId!==PROJECT||value.enabled!==true)fail('FD_PERFORMANCE_DISABLED',503);
  const effectiveFrom=runtimeFrom(value.effectiveFrom);
  if(!Number.isFinite(effectiveFrom))fail('FD_PERFORMANCE_RUNTIME_INVALID',503);
  if(now()<effectiveFrom)fail('FD_PERFORMANCE_BEFORE_ACTIVATION',409);
  return {...value,effectiveFrom};
 }
 function validateYear(year){if(!Number.isInteger(year)||year!==currentYear())fail('FD_PERFORMANCE_YEAR_INVALID');}
 async function metric(year,metricId){
  const definition=METRICS.find(item=>item.id===metricId);
  if(!definition)fail('INDICATOR_INVALID_INPUT');
  const snapshot=await store.get('indicatorSnapshots',year+'_'+definition.platform);
  const row=snapshot?.metrics?.find(item=>item.id===metricId);
  if(!row)fail('INDICATOR_BASELINE_REQUIRED',409);
  return {definition,row};
 }
 function summaryDelta(tx,uid,points,at){
  return Promise.all([tx.get('fdPerformanceSummaries',uid),tx.get('fdPerformanceReference','current')]).then(([old,ref])=>{
   const total=(old?.total||0)+points;
   tx.set('fdPerformanceSummaries',uid,{uid,total,updatedAt:at});
   tx.set('fdPerformanceReference','current',{maxTotal:Math.max(ref?.maxTotal||0,total),eligibleCount:(ref?.eligibleCount||0)+(old?0:1),updatedAt:at});
   return total;
  });
 }
 async function getPerformance(input,identity){
  if(!exact(input,[]))fail('INDICATOR_INVALID_INPUT');
  const config=await store.get('fdPerformanceRuntime','current');
  if(config?.enabled!==true||config?.projectId!==PROJECT||runtimeFrom(config?.effectiveFrom)>now())return {status:'PREPARING',uid:identity.uid,summary:{uid:identity.uid,total:0},reference:{maxTotal:0,eligibleCount:0},awards:[],suggestions:[],pendingSuggestions:[]};
  await runtime();
  const [summary,reference,awards,suggestions]=await Promise.all([
   store.get('fdPerformanceSummaries',identity.uid),store.get('fdPerformanceReference','current'),
   store.list('fdPerformanceAwards',[{field:'uid',op:'EQUAL',value:identity.uid}],200),
   store.list('fdPerformanceSuggestions',[{field:'uid',op:'EQUAL',value:identity.uid}],200)
  ]);
  const {canManage}=await authorize(identity,false);
  const pendingSuggestions=canManage?await store.list('fdPerformanceSuggestions',[{field:'status',op:'EQUAL',value:'PENDING'}],200):[];
  return {status:'READY',uid:identity.uid,summary:summary||{uid:identity.uid,total:0},reference:reference||{maxTotal:0,eligibleCount:0},awards,suggestions,pendingSuggestions};
 }
 async function acknowledge(input,identity){
  if(!exact(input,['metricId','year']))fail('INDICATOR_INVALID_INPUT');
  validateYear(input.year);
  const {row}=await metric(input.year,input.metricId);
  const key=identity.uid+'_'+input.metricId+'_'+input.year;
  await runtime();
  const result=await store.transaction(async tx=>{
   await freshTransaction(tx,identity,false);await runtime(tx);
   const existing=await tx.get('fdPerformanceAcknowledgements',key);
   if(existing)return {acknowledgement:existing,award:await tx.get('fdPerformanceAwards',key+'_ACK'),alreadyAcknowledged:true};
   const event={uid:identity.uid,metricId:input.metricId,year:input.year,createdAt:now()};
   const award={uid:identity.uid,category:'PERFORMANCE',modality:'ACKNOWLEDGEMENT',points:1,metricId:input.metricId,year:input.year,sourceId:key,createdAt:event.createdAt};
   tx.create('fdPerformanceAcknowledgements',key,event);tx.create('fdPerformanceAwards',key+'_ACK',award);await summaryDelta(tx,identity.uid,1,event.createdAt);
   return {acknowledgement:event,award,alreadyAcknowledged:false};
  });
  await authorize(identity,false);return result;
 }
 async function submitSuggestion(input,identity){
  if(!exact(input,['metricId','year','text'])||!validText(input.text))fail('INDICATOR_INVALID_INPUT');
  validateYear(input.year);await metric(input.year,input.metricId);
  const key=identity.uid+'_'+input.metricId+'_'+input.year;
  await runtime();
  const suggestion=await store.transaction(async tx=>{
   await freshTransaction(tx,identity,false);await runtime(tx);
   const old=await tx.get('fdPerformanceSuggestions',key);
   if(old)fail('FD_PERFORMANCE_SUGGESTION_EXISTS',409);
   const value={uid:identity.uid,metricId:input.metricId,year:input.year,text:input.text.trim(),status:'PENDING',createdAt:now()};
   tx.create('fdPerformanceSuggestions',key,value);return {id:key,...value};
  });
  await authorize(identity,false);return {suggestion};
 }
 async function reviewSuggestion(input,identity){
  if(!exact(input,['suggestionId','decision'])||typeof input.suggestionId!=='string'||!/^[A-Za-z0-9_.@+:%-]{1,512}$/.test(input.suggestionId)||!['APPROVED','REJECTED'].includes(input.decision))fail('INDICATOR_INVALID_INPUT');
  await authorize(identity,true);await runtime();
  const result=await store.transaction(async tx=>{
   await freshTransaction(tx,identity,true);await runtime(tx);
   const suggestion=await tx.get('fdPerformanceSuggestions',input.suggestionId);
   if(!suggestion)fail('FD_PERFORMANCE_SUGGESTION_NOT_FOUND',404);
   if(suggestion.uid===identity.uid)fail('FD_PERFORMANCE_SELF_REVIEW',403);
   if(suggestion.status!=='PENDING'){
    if(suggestion.status===input.decision){const award=input.decision==='APPROVED'?await tx.get('fdPerformanceAwards',input.suggestionId+'_SUGGESTION'):null;return {suggestion:{id:input.suggestionId,...suggestion},award,alreadyReviewed:true};}
    fail('FD_PERFORMANCE_REVIEW_CONFLICT',409);
   }
   const at=now(),saved={...suggestion,status:input.decision,reviewerUid:identity.uid,reviewedAt:at};
   tx.set('fdPerformanceSuggestions',input.suggestionId,saved);
   if(input.decision!=='APPROVED')return {suggestion:{id:input.suggestionId,...saved},award:null,alreadyReviewed:false};
   const award={uid:suggestion.uid,category:'PERFORMANCE',modality:'SUGGESTION',points:2,metricId:suggestion.metricId,year:suggestion.year,sourceId:input.suggestionId,createdAt:at};
   tx.create('fdPerformanceAwards',input.suggestionId+'_SUGGESTION',award);await summaryDelta(tx,suggestion.uid,2,at);
   return {suggestion:{id:input.suggestionId,...saved},award,alreadyReviewed:false};
  });
  await authorize(identity,true);return result;
 }
 async function execute(action,input,identity){
  if(action==='GET_PERFORMANCE'){await authorize(identity,false);return getPerformance(input,identity);}
  if(action==='ACKNOWLEDGE_INDICATOR'){await authorize(identity,false);return acknowledge(input,identity);}
  if(action==='SUBMIT_SUGGESTION'){await authorize(identity,false);return submitSuggestion(input,identity);}
  if(action==='REVIEW_SUGGESTION')return reviewSuggestion(input,identity);
  return null;
 }
 return Object.freeze({execute});
}
