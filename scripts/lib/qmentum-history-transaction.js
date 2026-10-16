import {historicalImportPlan,historicalSourceChunks} from './qmentum-history-plan.js';
export function encodeFirestore(value){
 if(value===null)return{nullValue:null};if(value instanceof Date)return{timestampValue:value.toISOString()};
 if(typeof value==='boolean')return{booleanValue:value};if(typeof value==='string')return{stringValue:value};
 if(typeof value==='number'&&Number.isFinite(value))return Number.isSafeInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(Array.isArray(value))return{arrayValue:{values:value.map(encodeFirestore)}};
 if(value&&typeof value==='object')return{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeFirestore(v)]))}};
 throw Error('QMENTUM_FIRESTORE_VALUE_INVALID');
}
export function decodeFirestore(value){
 if('nullValue'in value)return null;if('timestampValue'in value)return new Date(value.timestampValue);
 if('booleanValue'in value)return value.booleanValue;if('stringValue'in value)return value.stringValue;
 if('integerValue'in value)return Number(value.integerValue);if('doubleValue'in value)return value.doubleValue;
 if('arrayValue'in value)return(value.arrayValue.values||[]).map(decodeFirestore);
 if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decodeFirestore(v)]));throw Error('QMENTUM_FIRESTORE_RESPONSE_INVALID');
}
export async function historicalImportTransaction({request,baseName,preview,uid,operator,sourceCells,apply=false,beforeCommit=async()=>{},now=new Date()}){
 if(!/^projects\/(sahmt-17a16|demo-sahmt-[a-z0-9-]+)\/databases\/\(default\)\/documents$/.test(baseName))throw Error('QMENTUM_FA_REQUIRED');
 const batchPath='qmentumUnits/sahmt/imports/'+preview.hash;
 const paths=['users/'+uid,'qmentumAccess/'+uid,'qmentumConfig/current','qmentumUnits/sahmt',batchPath,batchPath+'/audit/operator'];
 for(let i=1;i<=6;i++){const path='qmentumUnits/sahmt/months/2026-'+String(i).padStart(2,'0');paths.push(path,path+'/history/1');}
 historicalSourceChunks(sourceCells).forEach((_,i)=>paths.push(batchPath+'/cells/'+i));
 const {transaction}=await request(':beginTransaction',{options:{readWrite:{}}});if(typeof transaction!=='string'||!transaction)throw Error('QMENTUM_TRANSACTION_INVALID');let committed=false;
 try{
  const documents=new Map(),raw=[];
  const read=async targets=>{const names=targets.map(path=>baseName+'/'+path),response=await request(':batchGet',{documents:names,transaction});
   if(!Array.isArray(response))throw Error('QMENTUM_TRANSACTION_READ_INVALID');const seen=new Set();
   for(const row of response){const name=row.found?.name||row.missing;if(!names.includes(name)||seen.has(name))throw Error('QMENTUM_TRANSACTION_READ_INVALID');seen.add(name);raw.push(row);if(row.found)documents.set(name.slice(baseName.length+1),decodeFirestore({mapValue:{fields:row.found.fields||{}}}));}
   if(seen.size!==names.length)throw Error('QMENTUM_TRANSACTION_READ_INCOMPLETE');};
  await read(paths);const version=documents.get('qmentumConfig/current')?.definitionVersion;if(!Number.isSafeInteger(version)||version<1)throw Error('QMENTUM_DEFINITION_INVALID');await read(['qmentumDefinitions/'+version]);
  const plan=historicalImportPlan({preview,documents,uid,operator,sourceCells,now});
  if(!apply||!plan.writes.length)return{...plan,committed:false};
  const writes=plan.writes.map(w=>({update:{name:baseName+'/'+w.path,fields:encodeFirestore(w.data).mapValue.fields},currentDocument:{exists:false}}));
  if(writes.length>60||Buffer.byteLength(JSON.stringify(writes))>2*1024*1024)throw Error('QMENTUM_IMPORT_BUDGET_EXCEEDED');
  await beforeCommit({readSnapshot:raw,plannedPaths:plan.writes.map(w=>w.path),sourceHash:preview.hash,createdAt:now.toISOString()});
  await request(':commit',{transaction,writes});committed=true;return{...plan,committed:true};
 }finally{if(!committed)try{await request(':rollback',{transaction});}catch{}}
}
