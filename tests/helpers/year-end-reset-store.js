import {encodeFields,decodeFields} from '../../worker-training/firestore.js';
import {emptyYearEndTotals,changeYearEndTotals} from '../../src/year-end-schedule-totals.js';
export function yearEndResetStore(){
 const projectId='demo-sahmt-year-end',base='yearEndSchedules/2026-2027',prefix=`projects/${projectId}/databases/(default)/documents/`,docs=new Map(),transactions=new Map(),calls=[];
 let revision=0,txId=0;
 const put=(path,data)=>docs.set(path,{name:prefix+path,fields:encodeFields(data),updateTime:'revision-'+ ++revision});
 const get=path=>docs.has(path)?decodeFields(docs.get(path).fields):null;
 put(base+'/policy/participation',{schemaVersion:1,cycle:'2026-2027',summaryVersion:1,siglasByUid:{one:'AB',two:'CD',three:'EF'},excludedUids:[],source:'KEEP_CONFIGURATION'});
 const record=(uid,position)=>({uid,sigla:{one:'AB',two:'CD',three:'EF'}[uid],plantao:'natal',grupo:'reveillon',position,createdAt:1,updatedAt:1});
 for(const [i,uid]of ['one','two'].entries())put(base+'/registrations/'+uid,record(uid,i+1));
 put(base+'/summary/totals',{...changeYearEndTotals(changeYearEndTotals(emptyYearEndTotals(),null,record('one',1)),null,record('two',2)),updatedAt:1});
 put(base+'/control/order',{lastPosition:2,lastParticipantUid:'two',retired:true});put('users/one',{uid:'one',active:true});put('otherCycle/registrations/one',{preserved:true});
 const request=async(path,body)=>{
  calls.push({path,body});
  if(path===':beginTransaction'){const transaction='tx-'+ ++txId;transactions.set(transaction,new Map());return {transaction};}
  if(path===':rollback'){transactions.delete(body.transaction);return {};}
  if(path===':commit'){
   const abort=()=>{throw Object.assign(Error('ABORTED'),{code:'ABORTED'});};
   for(const [path,version]of transactions.get(body.transaction)||[])if(docs.get(path)?.updateTime!==version)abort();
   for(const write of body.writes){const path=(write.delete||write.update.name).slice(prefix.length),prior=docs.get(path);if(write.currentDocument?.updateTime&&prior?.updateTime!==write.currentDocument.updateTime)abort();if(write.currentDocument?.exists===false&&prior)abort();}
   for(const write of body.writes){const path=(write.delete||write.update.name).slice(prefix.length);if(write.delete){docs.delete(path);continue;}const values=decodeFields(write.update.fields||{}),prior=get(path)||{};const next=write.updateMask?{...prior,...values}:values;for(const transform of write.updateTransforms||[])next[transform.fieldPath]=++revision;put(path,next);}
   transactions.delete(body.transaction);return {};
  }
  const url=new URL('http://emulator'+path),key=url.pathname.slice(1),transaction=url.searchParams.get('transaction');
  if(key.endsWith(':runQuery')){const rows=[...docs].filter(([key])=>key.startsWith(base+'/registrations/'));if(body.transaction)for(const [key,doc]of rows)transactions.get(body.transaction).set(key,doc.updateTime);return rows.map(([,document])=>({document:structuredClone(document)}));}
  if(transaction)transactions.get(transaction).set(key,docs.get(key)?.updateTime);
  return docs.has(key)?structuredClone(docs.get(key)):null;
 };
 return {request,projectId,base,docs,calls,put,get,record};
}
