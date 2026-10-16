import {prepareQmentumWrite,qmentumCanonical} from '../../src/qmentum-write.js';
import {encodeFirestore,decodeFirestore} from './qmentum-history-transaction.js';
export const QM14_SOURCE_HASH='d0857e203e2ea566debb7eb8dfea29b52e6d6115d2e0ac214c115f4285bd5fb1';
const counts=[14,18,24,40,54,63];
const root='qmentumUnits/sahmt/imports/'+QM14_SOURCE_HASH,auditPath=root+'/audit/qm14-unique-procedures';
export function qm14ConfirmationPlan({documents,uid,operator,confirmed,now=new Date()}){
 if(confirmed!=='DISTINCT_SURGERIES_COUNTED_ONCE')throw Error('QMENTUM_QM14_CONFIRMATION_REQUIRED');
 const get=p=>documents.get(p),profile=get('users/'+uid),grant=get('qmentumAccess/'+uid),config=get('qmentumConfig/current'),unit=get('qmentumUnits/sahmt');
 if(grant?.role!=='manager'||operator?.kind!=='GOOGLE_OAUTH'||!operator.email||profile?.uid!==uid||profile.active!==true||profile.access!==true||grant.uid!==uid||grant.active!==true||!grant.units?.includes('sahmt')||config?.enabled!==true||unit?.active!==true)throw Error('QMENTUM_PERMISSION_DENIED');
 const writes=[],months=[];
 for(let m=1;m<=6;m++){
  const period='2026-'+String(m).padStart(2,'0'),path='qmentumUnits/sahmt/months/'+period,current=get(path),N=counts[m-1];
  if(!current||current.importHash!==QM14_SOURCE_HASH||current.unitId!=='sahmt'||current.year!==2026||current.month!==m||current.inputs.counts.eventEpisodes!==N)throw Error('QMENTUM_QM14_SOURCE_CONFLICT');
  if(get(path+'/history/1')?.version!==1||get(path+'/history/1').importHash!==QM14_SOURCE_HASH)throw Error('QMENTUM_QM14_SOURCE_CONFLICT');
  if(current.version===2&&current.inputs.uniqueEventProceduresConfirmed===true&&current.inputs.counts.eventProcedures===N&&current.inputs.informedRates.QM14===null&&get(auditPath)){
   const h=get(path+'/history/2');if(h?.version!==2||qmentumCanonical(h.inputs)!==qmentumCanonical(current.inputs)||current.results.QM14.sourceMode!=='CALCULATED'||current.results.QM14.ratio!==1-N/current.inputs.counts.surgical)throw Error('QMENTUM_QM14_CONCURRENT_CHANGE');
   months.push({month:m,status:'ALREADY_CONFIRMED',N,D:current.inputs.counts.surgical,ratio:current.results.QM14.ratio});continue;
  }
  if(current.version!==1||current.status!=='DRAFT'||current.inputs.counts.eventProcedures!==null||current.inputs.uniqueEventProceduresConfirmed!==false||get(path+'/history/2'))throw Error('QMENTUM_QM14_CONCURRENT_CHANGE');
  const inputs=structuredClone(current.inputs);inputs.counts.eventProcedures=N;inputs.origins.eventProcedures='IMPORTED';inputs.uniqueEventProceduresConfirmed=true;inputs.informedRates.QM14=null;
  inputs.comment=inputs.comment.replace('QM14: taxa histórica informada calculada na fonte com episódios de eventos; contagem de procedimentos únicos ainda não confirmada. Não tratar como resultado validado.','').trim()+' QM14: administrador confirmou cirurgias distintas, contadas uma única vez; cálculo 1 − cirurgias com evento / procedimentos cirúrgicos.';
  const prepared=prepareQmentumWrite({uid,operation:'SAVE_MONTH',payload:{unitId:'sahmt',year:2026,month:m,inputs,baseVersion:1,definitionVersion:current.definitionVersion,referenceDate:current.referenceDate,action:'SAVE',reason:'Confirmação administrativa: os totais QM14 representam cirurgias distintas, cada uma contada uma única vez.',importHash:current.importHash},profile,grant,config,unit,current,definitions:get('qmentumDefinitions/'+current.definitionVersion),now});
  writes.push({path,data:prepared.data,existing:true},{path:path+'/history/2',data:structuredClone(prepared.data),existing:false});months.push({month:m,status:'CONFIRM',N,D:prepared.data.results.QM14.D,ratio:prepared.data.results.QM14.ratio});
 }
 if(writes.length){if(get(auditPath))throw Error('QMENTUM_QM14_AUDIT_CONFLICT');writes.push({path:auditPath,existing:false,data:{schemaVersion:1,operation:'QM14_CONFIRM_UNIQUE_PROCEDURES',sourceHash:QM14_SOURCE_HASH,confirmation:confirmed,confirmationSource:'EXPLICIT_USER_REPLY',performedBy:operator,authorizedAdministrator:uid,months:months.map(({month,N,D,ratio})=>({month,N,D,ratio})),createdAt:now}});}
 return{writes,months};
}
export async function qm14ConfirmationTransaction({request,baseName,uid,operator,confirmed,apply=false,beforeCommit=async()=>{}}){
 if(!/^projects\/(sahmt-17a16|demo-sahmt-[a-z0-9-]+)\/databases\/\(default\)\/documents$/.test(baseName))throw Error('QMENTUM_FA_REQUIRED');
 const paths=['users/'+uid,'qmentumAccess/'+uid,'qmentumConfig/current','qmentumUnits/sahmt',auditPath];for(let m=1;m<=6;m++){const path='qmentumUnits/sahmt/months/2026-'+String(m).padStart(2,'0');paths.push(path,path+'/history/1',path+'/history/2');}
 const {transaction}=await request(':beginTransaction',{options:{readWrite:{}}});if(!transaction)throw Error('QMENTUM_TRANSACTION_INVALID');let committed=false;
 try{const documents=new Map(),versions=new Map(),raw=[];const read=async paths=>{const names=paths.map(p=>baseName+'/'+p),rows=await request(':batchGet',{documents:names,transaction}),seen=new Set();if(!Array.isArray(rows))throw Error('QMENTUM_TRANSACTION_READ_INVALID');
  for(const r of rows){const n=r.found?.name||r.missing;if(!names.includes(n)||seen.has(n))throw Error('QMENTUM_TRANSACTION_READ_INVALID');seen.add(n);raw.push(r);if(r.found){const path=n.slice(baseName.length+1);documents.set(path,decodeFirestore({mapValue:{fields:r.found.fields||{}}}));versions.set(path,r.found.updateTime);}}if(seen.size!==names.length)throw Error('QMENTUM_TRANSACTION_READ_INCOMPLETE');};
  await read(paths);const definitionPaths=[...new Set(Array.from({length:6},(_,i)=>documents.get('qmentumUnits/sahmt/months/2026-'+String(i+1).padStart(2,'0'))?.definitionVersion))].map(v=>{if(!Number.isSafeInteger(v)||v<1)throw Error('QMENTUM_DEFINITION_INVALID');return'qmentumDefinitions/'+v;});await read(definitionPaths);
  const plan=qm14ConfirmationPlan({documents,uid,operator,confirmed});if(!apply||!plan.writes.length)return{...plan,committed:false};await beforeCommit({readSnapshot:raw,plannedPaths:plan.writes.map(w=>w.path),sourceHash:QM14_SOURCE_HASH});
  await request(':commit',{transaction,writes:plan.writes.map(w=>({update:{name:baseName+'/'+w.path,fields:encodeFirestore(w.data).mapValue.fields},currentDocument:w.existing?{updateTime:versions.get(w.path)}:{exists:false}}))});committed=true;return{...plan,committed:true};
 }finally{if(!committed)try{await request(':rollback',{transaction});}catch{}}
}
