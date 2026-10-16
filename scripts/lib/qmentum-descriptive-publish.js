import {createHash} from 'node:crypto';
import {historicalDescriptiveAnalyses,DESCRIPTIVE_VERSION} from './qmentum-descriptive-analysis.js';
import {calculateMonth} from '../../src/qmentum-engine.js';import {qmentumCanonical} from '../../src/qmentum-write.js';import {encodeFirestore,decodeFirestore} from './qmentum-history-transaction.js';
export async function descriptivePublishTransaction({request,baseName,uid,operator,apply=false,beforeCommit=async()=>{}}){
 if(!/^projects\/(sahmt-17a16|demo-sahmt-[a-z0-9-]+)\/databases\/\(default\)\/documents$/.test(baseName))throw Error('QMENTUM_FA_REQUIRED');
 const paths=['users/'+uid,'qmentumAccess/'+uid,'qmentumConfig/current','qmentumUnits/sahmt'];
 for(let m=1;m<=6;m++)paths.push('qmentumUnits/sahmt/months/2026-'+String(m).padStart(2,'0'));
 for(const m of [10,11,12])paths.push('qmentumUnits/sahmt/months/2025-'+m);
 const {transaction}=await request(':beginTransaction',{options:{readWrite:{}}});if(!transaction)throw Error('QMENTUM_TRANSACTION_INVALID');let committed=false;
 try{
  const docs=new Map(),raw=[];const read=async targets=>{const names=targets.map(p=>baseName+'/'+p),rows=await request(':batchGet',{documents:names,transaction}),seen=new Set();if(!Array.isArray(rows))throw Error('QMENTUM_TRANSACTION_READ_INVALID');for(const r of rows){const name=r.found?.name||r.missing;if(!names.includes(name)||seen.has(name))throw Error('QMENTUM_TRANSACTION_READ_INVALID');seen.add(name);raw.push(r);if(r.found)docs.set(name.slice(baseName.length+1),decodeFirestore({mapValue:{fields:r.found.fields||{}}}));}if(seen.size!==names.length)throw Error('QMENTUM_TRANSACTION_READ_INCOMPLETE');};
  await read(paths);const p=docs.get('users/'+uid),g=docs.get('qmentumAccess/'+uid),config=docs.get('qmentumConfig/current'),unit=docs.get('qmentumUnits/sahmt');
  if(p?.uid!==uid||p.active!==true||p.access!==true||g?.uid!==uid||g.active!==true||g.role!=='manager'||!g.units?.includes('sahmt')||config?.enabled!==true||unit?.active!==true||unit.unitId!=='sahmt'||operator?.kind!=='GOOGLE_OAUTH'||!operator.email)throw Error('QMENTUM_PERMISSION_DENIED');
  const rows=paths.filter(p=>p.includes('/months/')).map(p=>docs.get(p)).filter(Boolean),versions=[...new Set(rows.map(r=>r.definitionVersion))];if(versions.some(v=>!Number.isSafeInteger(v)||v<1))throw Error('QMENTUM_DEFINITION_INVALID');await read(versions.map(v=>'qmentumDefinitions/'+v));
  for(const r of rows)r.results=calculateMonth(r.inputs,docs.get('qmentumDefinitions/'+r.definitionVersion),{inputVersion:r.version,calculatedAt:null});
  const analyses=historicalDescriptiveAnalyses({rows}),batchId=createHash('sha256').update(DESCRIPTIVE_VERSION+':'+analyses.map(a=>a.id).join(':')).digest('hex'),auditPath='qmentumUnits/sahmt/analysisBatches/'+batchId,targets=analyses.map(a=>'qmentumUnits/sahmt/quarterlyAnalyses/'+a.id);await read([...targets,auditPath]);
  const writes=[];let existing=0;analyses.forEach((a,i)=>{const old=docs.get(targets[i]);if(old){if(old.signature!==a.signature||qmentumCanonical(old.paragraphs)!==qmentumCanonical(a.paragraphs)||old.promptVersion!==a.promptVersion)throw Error('QMENTUM_DESCRIPTIVE_EXISTING_CONFLICT');existing++;}else writes.push({path:targets[i],data:a});});
  if(!docs.has(auditPath))writes.push({path:auditPath,data:{schemaVersion:1,operation:'ASSISTED_DESCRIPTIVE_ANALYSES',year:2026,quarters:[1,2],indicatorCount:18,analysisCount:36,analysisIds:analyses.map(a=>a.id),performedBy:operator,authorizedAdministrator:uid,source:'EXISTING_FA_AGGREGATED_MONTHS',clinicalRecommendations:false,externalAiCalls:0,approvedAutomatically:false,createdAt:new Date()}});
  if(apply&&writes.length){await beforeCommit({readSnapshot:raw,plannedPaths:writes.map(w=>w.path),batchId});await request(':commit',{transaction,writes:writes.map(w=>({update:{name:baseName+'/'+w.path,fields:encodeFirestore(w.data).mapValue.fields},currentDocument:{exists:false}}))});committed=true;}
  return{analyses,existing,writes:apply?writes.length:0,plannedWrites:writes.length,batchId,committed};
 }finally{if(!committed)try{await request(':rollback',{transaction});}catch{}}
}
