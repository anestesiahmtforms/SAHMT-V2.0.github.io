import {prepareQmentumWrite,qmentumCanonical} from '../../src/qmentum-write.js';
import {periodKey} from '../../src/qmentum-engine.js';

// Trusted operator import. The application administrator is the responsible
// approver; the separately authenticated Google operator is recorded in the
// import audit. This never creates or impersonates a Firebase Auth session.
export function correctedHistoricalPreview(preview){
 if(preview?.year!==2026||preview.unitId!=='sahmt'||!/^[a-f0-9]{64}$/.test(preview.hash||''))throw Error('QMENTUM_HISTORY_SCOPE_INVALID');
 const months=preview.months.filter(m=>m.hasInput&&m.month>=1&&m.month<=6).map(m=>structuredClone(m));
 if(months.length!==6||months.some((m,i)=>m.month!==i+1))throw Error('QMENTUM_HISTORY_SIX_MONTHS_REQUIRED');
 const resolutions=[];
 for(const row of months){
  const c=row.inputs.counts,legacy=row.inputs.legacyRates,notes=['Importação histórica de 2026; fonte original preservada. Dados não fechados nem aprovados automaticamente.'];
  if(c.toxicity===0&&c.effectiveToxicity===0&&legacy.QM03?.value===1){resolutions.push({month:row.month,indicatorId:'QM03',code:'ZERO_DENOMINATOR_NOT_APPLICABLE'});notes.push('QM03: sem casos elegíveis; 100% da fórmula legada não é resultado válido.');}
  if(c.eventProcedures===null&&Number.isFinite(legacy.QM14?.value)&&legacy.QM14.value>=0&&legacy.QM14.value<=1){
   // Retain the source percentage as INFORMED, never invent unique procedures
   // from event episodes, and never approve this legacy formula as validated.
   row.inputs.informedRates.QM14=legacy.QM14.value;
   notes.push('QM14: taxa histórica informada calculada na fonte com episódios de eventos; contagem de procedimentos únicos ainda não confirmada. Não tratar como resultado validado.');
   resolutions.push({month:row.month,indicatorId:'QM14',code:'HISTORICAL_RATE_PRESERVED_UNVERIFIED'});
  }
  row.inputs.comment=notes.join(' ');
 }
 for(const d of preview.divergences||[])if(d.month>6)resolutions.push({month:d.month,indicatorId:d.indicatorId,code:'EMPTY_MONTH_FORMULA_EXCLUDED'});
 return{...preview,months,resolutions};
}
export function historicalSourceChunks(cells){
 const chunks=[];let part=[];for(const cell of cells){if(Buffer.byteLength(JSON.stringify(cell))>20000)throw Error('QMENTUM_SOURCE_CELL_TOO_LARGE');if(Buffer.byteLength(JSON.stringify([...part,cell]))>60000){chunks.push(part);part=[];}part.push(cell);}if(part.length)chunks.push(part);if(chunks.length>40)throw Error('QMENTUM_IMPORT_TOO_LARGE');return chunks;
}
export function historicalImportPlan({preview,documents,uid,operator,now=new Date(),backupReference='LOCAL_BACKUP_CONFIRMED',sourceCells=[]}){
 const p=correctedHistoricalPreview(preview),get=path=>documents.get(path)||null;
 const profile=get('users/'+uid),grant=get('qmentumAccess/'+uid),config=get('qmentumConfig/current'),unit=get('qmentumUnits/sahmt');
 if(!operator||operator.kind!=='GOOGLE_OAUTH'||!operator.email||grant?.role!=='manager')throw Error('QMENTUM_OPERATOR_REQUIRED');
 if(profile?.uid!==uid||profile.active!==true||profile.access!==true||grant.uid!==uid||grant.active!==true||!grant.units?.includes('sahmt')||config?.enabled!==true||unit?.unitId!=='sahmt'||unit.active!==true)throw Error('QMENTUM_PERMISSION_DENIED');
 const definitions=get('qmentumDefinitions/'+config?.definitionVersion),root='qmentumUnits/sahmt/imports/'+p.hash,chunks=historicalSourceChunks(sourceCells),oldBatch=get(root),auditPath=root+'/audit/operator';
 const batch={schemaVersion:1,hash:p.hash,unitId:'sahmt',year:2026,status:'STAGED',backupReference,chunkCount:chunks.length,createdBy:uid,createdAt:now,sheetNames:p.sourceSheetNames};
 const writes=[],statuses=[];
 if(oldBatch&&(oldBatch.hash!==p.hash||oldBatch.unitId!=='sahmt'||oldBatch.year!==2026||oldBatch.status!=='STAGED'||oldBatch.chunkCount!==chunks.length))throw Error('QMENTUM_IMPORT_BATCH_CONFLICT');
 if(!oldBatch)writes.push({path:root,data:batch});
 chunks.forEach((cells,index)=>{const path=root+'/cells/'+index,old=get(path),data={cells,hash:p.hash,index};if(old&&qmentumCanonical(old)!==qmentumCanonical(data))throw Error('QMENTUM_IMPORT_SOURCE_CONFLICT');if(!old)writes.push({path,data});});
 for(const row of p.months){
  const period=periodKey(2026,row.month),path='qmentumUnits/sahmt/months/'+period,current=get(path);
  if(current){if(current.importHash!==p.hash)throw Error('QMENTUM_HISTORY_EXISTING_CONFLICT');statuses.push({month:row.month,status:qmentumCanonical(current.inputs)===qmentumCanonical(row.inputs)?'ALREADY_IMPORTED':'ALREADY_IMPORTED_MODIFIED'});continue;}
  if(get(path+'/history/1'))throw Error('QMENTUM_HISTORY_ORPHAN_CONFLICT');
  const prepared=prepareQmentumWrite({uid,operation:'SAVE_MONTH',payload:{unitId:'sahmt',year:2026,month:row.month,inputs:row.inputs,baseVersion:0,definitionVersion:config?.definitionVersion,referenceDate:period+'-01',action:'IMPORT',reason:'Importação autorizada do histórico original de janeiro a junho de 2026, com revisão de divergências.',importHash:p.hash},profile,grant,config,unit,definitions,importBatch:oldBatch||batch,now});
  writes.push({path,data:prepared.data},{path:path+'/history/1',data:structuredClone(prepared.data)});statuses.push({month:row.month,status:'CREATE'});
 }
 if(!get(auditPath))writes.push({path:auditPath,data:{schemaVersion:1,operation:'HISTORICAL_IMPORT',performedBy:operator,authorizedAdministrator:uid,sourceHash:p.hash,year:2026,months:[1,2,3,4,5,6],resolutions:p.resolutions,approval:'USER_AUTHORIZED_IMPORT_AND_TECHNICAL_CORRECTIONS',createdAt:now}});
 return{writes,statuses,resolutions:p.resolutions,quarterlyPeriods:[1,2],sourceChunks:chunks.length};
}
