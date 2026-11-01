import {emptyInputs} from './qmentum-catalog.js';
import {periodKey} from './qmentum-engine.js';
import {prepareQmentumWrite,qmentumCanonical} from './qmentum-write.js';
import {reconcilePrintImport} from './qmentum-print-import.js';
export const PRINT_PARSER_VERSION='prints-2';
export const PRINT_COUNT_FIELDS=Object.freeze(['general','sedation','regional','spinal','epidural','local','support','anestheticProcedures','surgical','techniqueChanges','difficultAirway','toxicity','unplannedIcu','ponv','acutePain','diabetes','hypoglycemia','hypothermia','cardiacArrest']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Error('QMENTUM_PRINT_'+code);};
export function validatePrintPeriod(period){
 if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))fail('PERIOD_INVALID');
 const year=Number(period.slice(0,4)),month=Number(period.slice(5));periodKey(year,month);if(period<'2026-07')fail('SCOPE_DENIED');return{year,month};
}
export function assertPrintAccess({documents,uid,unitId}){
 if(typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||typeof unitId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(unitId))fail('PERMISSION_DENIED');
 const profile=documents.get('users/'+uid),grant=documents.get('qmentumAccess/'+uid),config=documents.get('qmentumConfig/current'),unit=documents.get('qmentumUnits/'+unitId);
 if(profile?.uid!==uid||profile.active!==true||profile.access!==true||grant?.uid!==uid||grant.active!==true||grant.role!=='manager'||!Array.isArray(grant.units)||!grant.units.includes(unitId)||config?.enabled!==true||unit?.active!==true||unit.unitId!==unitId)fail('PERMISSION_DENIED');
 return{profile,grant,config,unit};
}
export function sourceMetadata(sources){return (sources||[]).map(s=>Object.fromEntries(['kind','id','name','version','modifiedTime','checksum','size'].map(k=>[k,s[k]??null]))).sort((a,b)=>a.kind.localeCompare(b.kind));}
export function planPrintScan({files,baselines={},year,sourceYear}){
 periodKey(year,1);periodKey(sourceYear,1);if(!Array.isArray(files)||files.length>200)fail('SOURCE_LIMIT');const groups=new Map();
 for(const f of files){
  if(!['TECHNIQUES','INDICATORS'].includes(f.kind)||typeof f.name!=='string')continue;
  const match=/^(?:(\d{4})-)?(0[1-9]|1[0-2])\.(?:png|jpe?g)$/i.exec(f.name);if(!match)continue;
  const fileYear=match[1]?Number(match[1]):sourceYear,period=periodKey(fileYear,Number(match[2]));if(fileYear!==year||period<'2026-07')continue;
  const list=groups.get(period)||[];list.push(f);groups.set(period,list);
 }
 return{candidates:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([period,sources])=>{
  const techniques=sources.filter(f=>f.kind==='TECHNIQUES'),indicators=sources.filter(f=>f.kind==='INDICATORS');
  const status=techniques.length>1||indicators.length>1?'DUPLICATE':techniques.length!==1||indicators.length!==1?'MISSING_PAIR':!baselines[period]?'NEW':baselines[period].parserVersion===PRINT_PARSER_VERSION&&qmentumCanonical(sourceMetadata(sources))===qmentumCanonical(sourceMetadata(baselines[period].sources))?'UNCHANGED':'CHANGED';
  return{period,status,sources};
 })};
}
export function printMergeView({currentInputs,baseline,counts,resolutions={}}){
 const current=currentInputs||emptyInputs(),prior=baseline?{sourceCounts:baseline.sourceCounts,appliedCounts:baseline.appliedCounts}:null;return reconcilePrintImport({currentInputs:current,baseline:prior,sourceCounts:counts,resolutions});
}
export function preparePrintMutation({uid,unitId,period,preview,baseVersion,corrections={},resolutions={},requestHash,documents,now}){
 const {year,month}=validatePrintPeriod(period),auth=assertPrintAccess({documents,uid,unitId}),root='qmentumUnits/'+unitId;
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('CLOCK_INVALID');
 if(!hash(requestHash)||!preview||!hash(preview.id)||!hash(preview.sourceHash)||preview.createdBy!==uid||preview.unitId!==unitId||preview.period!==period||preview.parserVersion!==PRINT_PARSER_VERSION)fail('PREVIEW_INVALID');
 const receiptPath=root+'/printReceipts/'+preview.id,receipt=documents.get(receiptPath),previewPath=root+'/printPreviews/'+preview.id;
 const accessChecks=['users/'+uid,'qmentumAccess/'+uid,'qmentumConfig/current',root,previewPath];
 if(receipt){if(receipt.requestHash!==requestHash)fail('REQUEST_CONFLICT');return{status:receipt.status,version:receipt.version,writes:[],checks:accessChecks};}
 if(!Number.isSafeInteger(preview.expiresAt)||preview.expiresAt<=now.getTime()||preview.expiresAt>now.getTime()+1800000)fail('PREVIEW_EXPIRED');
 const path=root+'/months/'+period,current=documents.get(path)||null,sourcePath=root+'/printSources/'+period,previous=documents.get(sourcePath)||null;
 if(!Number.isSafeInteger(baseVersion)||baseVersion<0||preview.baseVersion!==baseVersion||(current?.version||0)!==baseVersion)throw Error('QMENTUM_VERSION_CONFLICT');
 if(current?.status==='CLOSED')throw Error('QMENTUM_MONTH_CLOSED');
 if(!corrections||typeof corrections!=='object'||Array.isArray(corrections)||Object.keys(corrections).some(k=>!PRINT_COUNT_FIELDS.includes(k)||!Number.isSafeInteger(corrections[k])||corrections[k]<0||corrections[k]>10000000))fail('CORRECTION_INVALID');
 const counts={...preview.counts,...corrections};if(Object.keys(counts).some(k=>!PRINT_COUNT_FIELDS.includes(k)||!Number.isSafeInteger(counts[k])||counts[k]<0||counts[k]>10000000)||!Number.isSafeInteger(counts.anestheticProcedures)||!Number.isSafeInteger(counts.surgical))fail('COUNTS_REQUIRED');
 const merge=printMergeView({currentInputs:current?.inputs,baseline:previous,counts,resolutions});if(merge.conflicts.length)fail('CONFLICTS_PENDING');
 const inputs=merge.inputs;for(const [field,value]of Object.entries(corrections))if(value!==preview.counts[field]&&inputs.counts[field]===value)inputs.origins[field]='MANUAL';
 const sourceCounts={...(previous?.sourceCounts||{}),...preview.counts},appliedCounts={...(previous?.appliedCounts||{})};for(const field of Object.keys(counts))appliedCounts[field]=inputs.counts[field];
 const baseline={schemaVersion:1,unitId,period,sourceCounts,appliedCounts,sources:preview.sources,sourceHash:preview.sourceHash,parserVersion:PRINT_PARSER_VERSION,confirmedBy:uid,confirmedAt:now};
 const changed=!current||qmentumCanonical(inputs)!==qmentumCanonical(current.inputs),writes=[],version=changed?baseVersion+1:baseVersion;
 if(changed){
  const batchPath=root+'/imports/'+preview.sourceHash,batch=documents.get(batchPath)||{schemaVersion:1,hash:preview.sourceHash,unitId,year,status:'STAGED',backupReference:'SOURCE_PRINTS_PRESERVED',chunkCount:1,createdBy:uid,createdAt:now,sheetNames:['PRINT_TECHNIQUES','PRINT_INDICATORS']};
  if(!current&&!documents.has(batchPath)){writes.push({path:batchPath,data:batch},{path:batchPath+'/cells/0',data:{hash:preview.sourceHash,index:0,cells:[{period,sourceHash:preview.sourceHash,sources:preview.sources,parserVersion:PRINT_PARSER_VERSION}]}});}
  const definitionVersion=current?.definitionVersion||auth.config.definitionVersion,definitions=documents.get('qmentumDefinitions/'+definitionVersion);
  const prepared=prepareQmentumWrite({uid,operation:'SAVE_MONTH',payload:{unitId,year,month,inputs,baseVersion,definitionVersion,referenceDate:current?.referenceDate||period+'-01',action:current?'SAVE':'IMPORT',reason:'Entrada mensal por dois prints conferida pelo gestor; totais independentes.',importHash:preview.sourceHash},...auth,current,definitions,importBatch:batch,now});
  writes.push({path,data:prepared.data},{path:path+'/history/'+version,data:prepared.data});
 }
 const status=changed?'CONFIRMED':'UNCHANGED';
 writes.push({path:sourcePath,data:baseline},{path:receiptPath,data:{schemaVersion:1,unitId,period,previewId:preview.id,sourceHash:preview.sourceHash,requestHash,parserVersion:PRINT_PARSER_VERSION,actorUid:uid,status,version,confirmedCounts:counts,corrections,resolutions,sources:preview.sources,confirmedAt:now}});
 const checks=[...accessChecks,path,sourcePath,receiptPath,'qmentumDefinitions/'+(current?.definitionVersion||auth.config.definitionVersion)];
 return{status,version,writes,checks,baseline,changes:merge.changes};
}
