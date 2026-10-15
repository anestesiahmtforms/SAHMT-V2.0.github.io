import {calculateMonth,periodKey,validateInputs,validateDefinitions} from './qmentum-engine.js';
import {QMENTUM_ENGINE} from './qmentum-catalog.js';
import {transitionMonth} from './qmentum-workflow.js';
export const qmentumCanonical=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(qmentumCanonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+qmentumCanonical(value[k])).join(',')+'}':JSON.stringify(value);
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
export function prepareQmentumWrite({uid,operation,payload,profile,grant,config,unit,current=null,definitions,importBatch=null,now}){
 if(typeof uid!=='string'||!uid||profile?.uid!==uid||profile.active!==true||profile.access!==true||grant?.uid!==uid||grant.active!==true||!['collector','reviewer','manager'].includes(grant.role)||!Array.isArray(grant.units)||config?.enabled!==true)throw Error('QMENTUM_PERMISSION_DENIED');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('QMENTUM_CLOCK_INVALID');
 if(operation==='PUBLISH_DEFINITION'){
  if(grant.role!=='manager')throw Error('QMENTUM_PERMISSION_DENIED');
  if(!exact(payload,['definitions']))throw Error('QMENTUM_INPUT_INVALID');
  const d=validateDefinitions(payload.definitions);
  if(d.version!==config.definitionVersion+1||current)throw Error('QMENTUM_VERSION_CONFLICT');
  for(const item of Object.values(d.items))if(!exact(item,['approved','criterion','target','targetSource','targetValidated','populationKey']))throw Error('QMENTUM_DEFINITION_INVALID');
  return{kind:'definition',version:d.version,data:{version:d.version,validFrom:d.validFrom,reason:d.reason,referenceVersion:d.referenceVersion,items:JSON.parse(JSON.stringify(d.items)),createdBy:uid,createdAt:now}};
 }
 if(operation!=='SAVE_MONTH'||!exact(payload,['unitId','year','month','inputs','baseVersion','definitionVersion','referenceDate','action','reason','importHash']))throw Error('QMENTUM_INPUT_INVALID');
 const p=payload,period=periodKey(p.year,p.month);
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(p.unitId)||!grant.units.includes(p.unitId)||unit?.unitId!==p.unitId||unit.active!==true)throw Error('QMENTUM_PERMISSION_DENIED');
 if(!Number.isSafeInteger(p.baseVersion)||p.baseVersion<0||typeof p.reason!=='string'||p.reason.length>1000||typeof p.referenceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.referenceDate)||p.referenceDate.slice(0,7)!==period||p.importHash!==null&&!/^[a-f0-9]{64}$/.test(p.importHash))throw Error('QMENTUM_INPUT_INVALID');
 const reference=new Date(p.referenceDate+'T12:00:00Z');if(!Number.isFinite(reference.getTime())||reference.toISOString().slice(0,10)!==p.referenceDate)throw Error('QMENTUM_INPUT_INVALID');
 if(!exact(p.inputs,['counts','notApplicable','origins','informedRates','legacyRates','attribution48','attribution30','uniqueEventProceduresConfirmed','techniqueUniverseConfirmed','comment']))throw Error('QMENTUM_INPUT_INVALID');
 validateInputs(p.inputs);validateDefinitions(definitions);
 if((current?.version||0)!==p.baseVersion)throw Error('QMENTUM_VERSION_CONFLICT');
 const version=p.action==='REBASE'?config.definitionVersion:current?.definitionVersion||p.definitionVersion||config.definitionVersion;
 if(definitions.version!==version||definitions.validFrom>period)throw Error('QMENTUM_DEFINITION_NOT_EFFECTIVE');
 if(['REVIEW','CLOSE','REOPEN','REBASE'].includes(p.action)&&qmentumCanonical(p.inputs)!==qmentumCanonical(current?.inputs))throw Error('QMENTUM_SAVE_BEFORE_REVIEW');
 if(p.action==='IMPORT'&&(!importBatch||importBatch.status!=='STAGED'||importBatch.year!==p.year||importBatch.unitId!==p.unitId))throw Error('QMENTUM_IMPORT_NOT_STAGED');
 const results=calculateMonth(p.inputs,definitions,{inputVersion:p.baseVersion+1,calculatedAt:null});
 const status=transitionMonth(current,p.action,grant.role,p.reason,results);
 const data={schemaVersion:1,unitId:p.unitId,year:p.year,month:p.month,period,version:p.baseVersion+1,status,inputs:JSON.parse(JSON.stringify(p.inputs)),results,definitionVersion:version,referenceVersion:definitions.referenceVersion,engineVersion:QMENTUM_ENGINE,referenceDate:p.referenceDate,importHash:current?.importHash||p.importHash,createdBy:current?.createdBy||uid,createdAt:current?.createdAt||now,updatedBy:uid,updatedAt:now,action:p.action,reason:p.reason.trim(),reviewedBy:p.action==='REVIEW'?uid:['SAVE','REOPEN','REBASE'].includes(p.action)?null:current?.reviewedBy||null};
 if(JSON.stringify(data).length>160000)throw Error('QMENTUM_DOCUMENT_TOO_LARGE');
 return{kind:'month',version:data.version,data};
}
