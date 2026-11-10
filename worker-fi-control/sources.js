import {canReadRecord,normalize} from './fi-ai-policy.js';
import {canManageManagementDocuments,documentGroupsFromAccess} from '../src/document-access.js';
import {QMENTUM_INDICATORS} from '../src/qmentum-catalog.js';
import {isCurrentMessage} from '../communication/domain.js';
import {SAHMT_START_ISO} from '../worker-indicators/sahmt-performance-period.js';
import {ownSchedulePositions,validScheduleSigla} from './personal-schedule.js';
import {trainingAccessPath,trainingPathAllowed} from '../src/html-training-folders.js';
import {gunzipSync} from 'node:zlib';
import {Buffer} from 'node:buffer';
import {catalogCollections,catalogIndexId} from './catalog-index.js';
export const SOURCE_COLLECTIONS=Object.freeze({FA:['users','documentAccessEmails','accessRequests','appConfig','userCategories'],FB:['users','documents','scopedDocuments','managementAreas','documentAccessEmails','trainings','learningActivities','activities','evaluationRuntime','htmlTrainings','htmlTrainingSettings'],FC:['users','qmentumAccess','qmentumConfig','qmentumUnits'],FD:['sahmtPerformanceReference','sahmtPerformanceRuns'],FF:['users','communicationMessages'],FG:['users','checklists'],FH:['users','labels'],FJ:['users','contacts','events','scheduleDays']});
const FB_CATALOG_QUERY_LIMIT=301;
let cachedHtmlIndex;
async function loadHtmlIndex(store){
 const manifest=await store.get('fiSearchRecords','html-library');
 if(!/^[a-f0-9]{64}$/.test(manifest?.revision)||!Number.isSafeInteger(manifest.count)||manifest.count<1||manifest.count>300)throw Error('HTML_INDEX_UNAVAILABLE');
 if(cachedHtmlIndex?.revision===manifest.revision)return cachedHtmlIndex.entries;
 const data=await store.get('fiSearchRecords','html-library-content');
 if(data?.revision!==manifest.revision||typeof data.compressed!=='string'||data.compressed.length>700000)throw Error('HTML_INDEX_STALE');
 const entries=JSON.parse(gunzipSync(Buffer.from(data.compressed,'base64'),{maxOutputLength:2*1024*1024}).toString('utf8'));
 if(!Array.isArray(entries)||entries.length!==manifest.count)throw Error('HTML_INDEX_INVALID');
 cachedHtmlIndex={revision:manifest.revision,entries};
 return entries;
}
const admin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
const permission=(p,...names)=>admin(p)||names.some(n=>p?.permissions?.[n]===true);
const eq=(field,value)=>({field,op:'EQUAL',value});
const own=r=>r.active!==false&&r.deleted!==true&&r.sheetDeleted!==true;
const version=r=>String(r.version||r.updatedAt||r.createdAt||'1');
const compact=(...v)=>v.filter(x=>typeof x==='string'&&x.trim()).join(' · ').slice(0,5000);
function preview(value){try{const u=new URL(value),m=u.pathname.match(/^\/(?:file|document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/);if(u.protocol==='https:'&&!u.username&&!u.password&&m&&['drive.google.com','docs.google.com'].includes(u.hostname))return u.origin+u.pathname.slice(0,u.pathname.indexOf(m[1])+m[1].length)+'/preview';}catch{}return '';}
async function performanceMetrics(fd,period){
 if(!fd||period<SAHMT_START_ISO.slice(0,7))return [];
 const year=Number(period.slice(0,4)),month=Number(period.slice(5));
 const days=Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=>`${period}-${String(i+1).padStart(2,'0')}`);
 const rows=await fd.getMany(days.map(day=>['sahmtPerformanceRuns',day+'_02']));
 const confirmed=rows.filter((r,i)=>r?.batchId===days[i]+'_02'&&r.status==='CONFIRMED');
 const observed=rows.filter((r,i)=>r?.batchId===days[i]+'_02'&&['CONFIRMED','PARTIAL','FAILED'].includes(r.status));
 if(!observed.length)return [];
 const durations=confirmed.map(r=>r.finishedAt-r.cutoff).filter(v=>Number.isFinite(v)&&v>=0&&v<=3600000).sort((a,b)=>a-b);
 return [
  {id:'FD.batch_confirmed',label:'Consolidações diárias confirmadas',value:confirmed.length,unit:'dias'},
  {id:'FD.batch_partial',label:'Consolidações diárias com falha ou resultado parcial',value:observed.length-confirmed.length,unit:'dias'},
  {id:'FD.batch_missing',label:'Dias sem conclusão registrada',value:days.length-observed.length,unit:'dias'},
  ...(durations.length?[{id:'FD.batch_p95',label:'P95 do tempo entre o horário previsto e a confirmação da consolidação',value:durations[Math.ceil(durations.length*.95)-1],unit:'ms'}]:[])
 ];
}
export function createFiSourceProvider({stores,indexStore,resolveIdentity,now=Date.now}={}){
 const coverage=[];
 async function identity(source,actor){
  if(resolveIdentity)return resolveIdentity(source,actor);
  const store=stores[source];if(!store)return null;
  const rows=await store.list('users',[eq('email',actor.email)],3);
  if(rows.length!==1)return null;const p=rows[0];
  return p.uid===p.id&&String(p.email||'').toLowerCase()===actor.email&&p.active===true&&p.access===true?p:null;
 }
 const record=(source,collection,row,details)=>({schemaVersion:1,id:`${source}.${collection}.${row.id}`,source,active:row.active!==false,title:row.title||'',text:'',url:'#/home',version:version(row),sourceAccess:'EXPLICIT',...details});
 function unavailable(source,error){
  const labels={FB:'Gestão',FF:'Comunicados',FG:'Checklist',FH:'Etiquetas',FJ:'Escala e Eventos'};
  const label=labels[source.split('.')[0]];
  const detail=error.code==='FI_SOURCE_READ_BUDGET'?(label?`A fonte ${label} atingiu o limite diário de consulta.`:'Uma fonte atingiu o limite diário de consulta.'):error.code==='FI_STORE_QUERY_LIMIT'?'Uma fonte excedeu a quantidade que a pesquisa pode verificar nesta versão.':undefined;
  coverage.push({source,status:'UNAVAILABLE',...(detail?{detail}:{})});
 }
 async function scope(source,fn){
  if(!stores[source]){coverage.push({source,status:'NOT_CONFIGURED'});return [];}
  try{const value=await fn(stores[source]);coverage.push({source,status:'AVAILABLE'});return value;}catch(error){unavailable(source,error);return [];}
 }
 async function catalogList(fb,collection,catalogue,score){
  try{
   if(!catalogue)return await fb.list(collection,[],FB_CATALOG_QUERY_LIMIT);
   const indexed=catalogue[collection];
   const ids=new Set(indexed.filter(row=>score(row)>0).map(row=>row.id));
   if(collection==='scopedDocuments'){
    for(const row of indexed){
     if(row.id.startsWith('pdf_evaluation_')&&ids.has(row.id.slice(4)))ids.add(row.id);
    }
   }
   const keys=[...ids];
   const rows=await fb.getMany(keys.map(id=>[collection,id]));
   return rows.flatMap((row,i)=>row?[{...row,id:keys[i]}]:[]);
  }
  catch(error){unavailable(`FB.${collection}`,error);return [];}
 }
 async function currentCatalogue(score){
  if(!indexStore||typeof score!=='function')return null;
  const snapshot=await indexStore.get('fiSearchRecords',catalogIndexId).catch(()=>null);
  if(snapshot?.schemaVersion!==1||!Number.isSafeInteger(snapshot.updatedAt)||now()-snapshot.updatedAt>18*60*60*1000)return null;
  return catalogCollections.every(collection=>Array.isArray(snapshot.sections?.[collection])&&snapshot.sections[collection].length<FB_CATALOG_QUERY_LIMIT)?snapshot.sections:null;
 }
 async function htmlMaterials(fb,actor,profile,gate,groups,faGroups,effective,score){
  if(!indexStore||typeof score!=='function')return [];
  const source='FB.htmlTrainings';
  try{
   const entries=await loadHtmlIndex(indexStore);
   const matches=entries.filter(entry=>score(entry)>0);
   if(!matches.length)return [];
   const [folders,...current]=await fb.getMany([['htmlTrainingSettings','folders'],...matches.map(entry=>['htmlTrainings',entry.id])]);
   const rows=[];
   let stale=false;
   for(const [i,entry] of matches.entries()){
    const material=current[i];
    if(material?.status!=='PUBLISHED')continue;
    if(!['GENERAL','RESTRICTED'].includes(material.audienceGroup)||typeof material.category!=='string'||!material.category.trim()||material.category.length>80)continue;
    const manages=admin(profile)||material.managerUid===profile.uid;
    if(!manages&&!groups.includes(material.audienceGroup))continue;
    const restricted=material.audienceGroup==='RESTRICTED'||/DOCUMENTOS? ADMINISTRATIV|ADMINISTRATIVE|ORGANOGRAMA|ORGANOGRAM/.test(normalize(material.category))||/ORGANOGRAMA|ORGANOGRAM/.test(normalize(material.title));
    if(restricted&&(!effective||!(manages||groups.includes('RESTRICTED'))||!(admin(gate)||gate.permissions?.documentsManage===true||faGroups.includes('RESTRICTED'))))continue;
    if(material.id!==entry.id||material.version!==entry.version||material.title!==entry.title){stale=true;continue;}
    const folderActive=trainingPathAllowed(folders,trainingAccessPath(material));
    rows.push(record('FB','htmlTrainings',material,{kind:'document',audience:restricted?'RESTRICTED':'GENERAL',category:material.category,classificationVerified:true,folderActive,sourceAllowedUids:[actor.uid],text:entry.text,searchText:entry.searchText,url:''}));
   }
   if(stale)coverage.push({source,status:'UNAVAILABLE',detail:'Algumas edições do acervo HTML ainda aguardam atualização no índice.'});
   return rows;
  }catch(error){unavailable(source,error);return [];}
 }
 async function documents(actor,score){return scope('FB',async fb=>{
  const p=await identity('FB',actor);if(!p||!permission(p,'managementRead','documentsManage','qualityManage','trainingsRead','trainingsManage','managementActivityWrite'))return [];
  const runtime=await fb.get('evaluationRuntime','independentFbCutover');
  if(runtime?.status!=='ACTIVE'||runtime.release!=='fb-independent-20261022-v1')return [];
  const fa=stores.FA;if(!fa)return [];const gate=await fa.get('users',actor.uid);
  if(!gate||gate.active!==true||gate.access!==true||String(gate.email||'').toLowerCase()!==actor.email)return [];
  const rows=[],catalogue=await currentCatalogue(score);
  if(permission(p,'managementRead','documentsManage','qualityManage')&&permission(gate,'managementRead','documentsManage','qualityManage')){
   const assignmentId=actor.memberCategories?.includes('EFETIVO')?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(actor.email)))),v=>v.toString(16).padStart(2,'0')).join(''):'';
   const [access,restrictedGrants]=await Promise.all([
    fb.get('documentAccessEmails',actor.email),
    assignmentId?fa.getMany([['documentAccessEmails',actor.email],['userCategories',assignmentId]]).catch(error=>{
     unavailable('FB.restrictedDocuments',error);return [];
    }):[]
   ]);
   const [faAccess,assignment]=restrictedGrants;
   const effective=assignment?.schemaVersion===1&&assignment.identityStatus==='LINKED'&&assignment.uid===actor.uid&&assignment.email===actor.email&&assignment.memberCategories?.includes('EFETIVO');
   const groups=documentGroupsFromAccess(access,actor.email),faGroups=documentGroupsFromAccess(faAccess,actor.email);
   rows.push(...await htmlMaterials(fb,actor,p,gate,groups,faGroups,effective,score));
   const documentCollections=['documents','scopedDocuments'];
   const documents=await Promise.all(documentCollections.map(collection=>catalogList(fb,collection,catalogue,score)));
   const areaIds=[...new Set(documents.flat().map(row=>row.managementAreaId).filter(id=>typeof id==='string'&&id))];
   const areas=await fb.getMany(areaIds.map(id=>['managementAreas',id])).catch(error=>{
    unavailable('FB.managementAreas',error);return [];
   });
   const areaById=new Map(areas.flatMap((area,i)=>area?[[areaIds[i],{...area,id:areaIds[i]}]]:[]));
   for(const [index,collection] of documentCollections.entries()){
   const docs=documents[index];
   const authorized=new Map();
   for(const d of docs){
    if(d.deleted===true||d.trashed===true)continue;
    const area=d.managementAreaId?areaById.get(d.managementAreaId):null;
    if(d.managementAreaId&&!area)continue;
    const legacyRestricted=/DOCUMENTOS? ADMINISTRATIV|ADMINISTRATIVE|ORGANOGRAMA|ORGANOGRAM/.test(normalize(d.category))||/ORGANOGRAMA|ORGANOGRAM/.test(normalize(d.title));
    if(collection==='scopedDocuments'&&!['GENERAL','RESTRICTED'].includes(d.audienceGroup))continue;
    if(typeof d.category!=='string'||!d.category.trim()||d.category.length>80)continue;
    const audience=legacyRestricted||d.audienceGroup==='RESTRICTED'?'RESTRICTED':'GENERAL';
    const manages=canManageManagementDocuments(p,area||{id:''},p.uid),faManages=canManageManagementDocuments(gate,area||{id:''},actor.uid);
    if(audience==='RESTRICTED'&&(!effective||!(manages||groups.includes('RESTRICTED'))||!(faManages||faGroups.includes('RESTRICTED'))))continue;
    if(collection==='scopedDocuments'&&!(manages||permission(p,'managementRead')&&groups.includes(d.audienceGroup)))continue;
    // FB owns the general catalogue after cutover. Restricted documents still
    // require both sources' current grants and the effective member category.
    if(collection==='scopedDocuments'&&audience==='RESTRICTED'&&!(faManages||permission(gate,'managementRead')&&faGroups.includes(d.audienceGroup)))continue;
    if(collection==='documents'&&(!(permission(p,'managementRead','documentsManage')||manages)||!(permission(gate,'managementRead','documentsManage')||faManages)))continue;
    // Only passive previews may be opened from search; forms/quizzes never become actionable.
    const url=preview(d.materialPdfUrl||d.driveUrl);
    const result=record('FB',collection,d,{kind:'document',audience,category:d.category,classificationVerified:true,folderActive:area?.active!==false,sourceAllowedUids:[actor.uid],title:String(d.title||'Documento'),text:compact(d.title,d.description,d.category),url});
    if(canReadRecord(actor,result))authorized.set(d.id,{document:d,result});
   }
   if(collection==='scopedDocuments'){
    for(const {document,result} of authorized.values()){
     if(result.url||!document.driveFileId||document.id!==`evaluation_${document.driveFileId}`)continue;
     const paired=authorized.get(`pdf_${document.id}`);
     if(!paired||paired.result.audience!==result.audience||paired.result.active!==result.active)continue;
     const pdf=paired.document;
     if(['audienceGroup','category','managementAreaId'].some(field=>document[field]!==pdf[field]))continue;
     if(!pdf.driveFileId||pdf.driveUrl!==`https://drive.google.com/file/d/${pdf.driveFileId}/view`)continue;
     result.url=preview(pdf.driveUrl);
    }
   }
   rows.push(...Array.from(authorized.values(),entry=>entry.result));
   }
  }
  if(permission(p,'trainingsRead','trainingsManage')&&permission(gate,'trainingsRead','trainingsManage')){
   for(const d of await catalogList(fb,'trainings',catalogue,score)){
    if(d.deleted===true||d.trashed===true)continue;
    rows.push(record('FB','trainings',d,{kind:'general',audience:'GENERAL',sourceAllowedUids:[actor.uid],text:compact(d.title,d.description),url:''}));
   }
   for(const d of await catalogList(fb,'learningActivities',catalogue,score)){
    if(d.deleted===true||d.trashed===true||d.showInTraining!==true||!['ACTIVE','INACTIVE'].includes(d.status))continue;
    const audience=d.audienceType==='ALL'&&d.audienceValue===''||d.audienceType==='ROLE'&&d.audienceValue===p.role||d.audienceType==='USER'&&d.audienceValue===p.uid;
    if(!audience)continue;
    rows.push(record('FB','learningActivities',d,{kind:'general',audience:'GENERAL',active:d.status==='ACTIVE',sourceAllowedUids:[actor.uid],text:compact(d.title,d.description,d.category),url:preview(d.resourceUrl)}));
   }
  }
  if(permission(p,'managementRead','managementActivityWrite')&&permission(gate,'managementRead','managementActivityWrite')){
   const activities=new Map();
   const relations=[eq('createdByUid',p.uid),...['responsibleUids','participantUids'].map(field=>({field,op:'ARRAY_CONTAINS',value:p.uid}))];
   for(const relation of relations){
    try{for(const activity of await fb.list('activities',[relation],101))activities.set(activity.id,activity);}
    catch(error){unavailable('FB.activities',error);}
   }
   for(const activity of activities.values()){
    if(!own(activity)||activity.contextType!=='MANAGEMENT_AREA'||activity.visibility!=='AREA'||typeof activity.title!=='string')continue;
    const authored=activity.createdByUid===p.uid,assigned=['responsibleUids','participantUids'].some(field=>Array.isArray(activity[field])&&activity[field].includes(p.uid));
    if(!authored&&!assigned)continue;
    rows.push(record('FB','activities',activity,{kind:'operational',audience:'INVOLVED',sourceAllowedUids:[actor.uid],authorUid:authored?actor.uid:'',participantUids:assigned?[actor.uid]:[],text:compact(activity.description,activity.status,activity.priority,activity.dueAt),url:'#/management'}));
   }
  }
  coverage.push({source:'FB.documents',status:'CONTENT_NOT_INDEXED',detail:'Para arquivos externos do Drive, a busca usa os títulos e as descrições cadastrados.'});return rows;
 });}
 async function operational(source,collection,actor,required,fields,arrayFields,route){return scope(source,async store=>{
  const p=await identity(source,actor);if(!p||!permission(p,...required))return [];
  const rows=new Map(),add=items=>items.forEach(r=>rows.set(r.id,r));
  add(await store.list(collection,[eq('createdByUid',p.uid)],101));
  if(source==='FG')add(await store.list(collection,[eq('responsibleUid',p.uid)],101));
  let sigla=typeof p.sigla==='string'?p.sigla.trim().toUpperCase():'';
  if(/^(?:[A-Z]{2}|L2)$/.test(sigla)){
   const members=await store.list('users',[eq('sigla',sigla)],3);
   if(members.length!==1||members[0].uid!==p.uid)sigla='';
  }else sigla='';
  if(sigla){
   for(const field of fields)add(await store.list(collection,[eq(field,sigla)],101));
   for(const field of arrayFields)add(await store.list(collection,[{field,op:'ARRAY_CONTAINS',value:sigla}],101));
  }
  let formalName='';
  if(source==='FJ'){
   const contacts=await store.list('contacts',[eq('email',actor.email)],3);
   if(contacts.length===1&&typeof contacts[0].name==='string'){
    const candidates=await store.list('contacts',[eq('name',contacts[0].name)],3);
    if(candidates.length===1&&String(candidates[0].email||'').toLowerCase()===actor.email){formalName=contacts[0].name;add(await store.list(collection,[eq('substitute',formalName)],101));}
   }
  }
  const result=[];
  for(const r of rows.values()){
   if(!own(r)||r.anonymous===true)continue;
   const authored=r.createdByUid===p.uid,participates=source==='FG'&&r.responsibleUid===p.uid||!!sigla&&(fields.some(f=>r[f]===sigla)||arrayFields.some(f=>Array.isArray(r[f])&&r[f].includes(sigla)))||!!formalName&&r.substitute===formalName;
   if(!authored&&!participates)continue;
   const details=source==='FJ'?[r.eventType,r.description,r.memberSigla,r.scheduleSigla,r.substitute,r.shift,r.memberStatus]:
    source==='FG'?[r.stationName,r.stationId,r.condition,r.occurrence]:[r.type,r.procedureCode,r.insurance];
   result.push(record(source,collection,r,{kind:'operational',audience:'INVOLVED',sourceAllowedUids:[actor.uid],authorUid:authored?actor.uid:'',participantUids:participates?[actor.uid]:[],title:compact(source==='FJ'?'Evento operacional':source==='FG'?'Checklist':'Etiqueta',r.eventType||r.type,r.date),text:compact(r.date,...details,r.status),url:route}));
  }
  return result;
 });}
 async function notifications(actor){return scope('FF',async store=>{
  const p=await identity('FF',actor);if(!p)return [];
  const rows=await store.list('communicationMessages',[eq('audienceValue',p.uid)],101),result=[];
  for(const r of rows){
   if(r.audienceType!=='USER'||r.audienceValue!==p.uid||!own(r)||!isCurrentMessage(r,now()))continue;
   result.push(record('FF','communicationMessages',r,{kind:'notification',audience:'INVOLVED',sourceAllowedUids:[actor.uid],recipientUids:[actor.uid],title:String(r.title||'Notificação'),text:compact(r.title,r.message),url:'#/communications'}));
  }
  coverage.push({source:'FC.occurrenceReports',status:'INVOLVEMENT_MAPPING_REQUIRED',detail:'Notificações sem vínculo formal de envolvidos não são liberadas pela pesquisa.'});return result;
 });}
 async function personalSchedule(actor,question){
  const fj=stores.FJ;
  try{
   const profile=await identity('FJ',actor);
   if(!profile||!permission(profile,'scheduleRead','scheduleWrite','eventsRead','eventsWrite','checklistSign'))return {status:'forbidden'};
   if(question.status!=='lookup')return question;
   const {day}=question;
   const contacts=await fj.list('contacts',[eq('email',actor.email)],3);
   const contact=contacts[0],sigla=String(contact?.sigla||'').trim().toUpperCase();
   if(contacts.length!==1||contact.active!==true||contact.email!==actor.email||contact.id!==sigla||!validScheduleSigla(sigla))return {status:'identity_unlinked'};
   const positions=ownSchedulePositions(await fj.get('scheduleDays',day),day,sigla);
   if(!positions)return {status:'schedule_missing',day};
   return positions.length?{status:'found',day,positions}:{status:'not_assigned',day};
  }catch{return {status:'unavailable'};}
 }
 async function monthlyAccess(actor){
  if(!admin(actor.profile))throw Error('FORBIDDEN');
  const fc=stores.FC;if(!fc)throw Error('SOURCE_UNAVAILABLE');
  const p=await identity('FC',actor);if(!p)throw Error('SOURCE_FORBIDDEN');
  const [grant,config]=await fc.getMany([['qmentumAccess',p.uid],['qmentumConfig','current']]);
  if(grant?.uid!==p.uid||grant.active!==true||!['reviewer','manager'].includes(grant.role)||!Array.isArray(grant.units)||!grant.units.length||grant.units.length>20||grant.units.some(id=>!(/^[A-Za-z0-9_-]{1,80}$/).test(id)))throw Error('SOURCE_FORBIDDEN');
  if(config?.enabled!==true)throw Error('SOURCE_UNAVAILABLE');
  const units=await fc.getMany(grant.units.map(id=>['qmentumUnits',id]));
  return [...new Set(grant.units.filter((id,i)=>units[i]?.active===true&&units[i].unitId===id))].sort();
 }
 return {coverage,monthlyAccess,personalSchedule,async searchRecords(actor,score){
  coverage.length=0;
  const rows=[...await documents(actor,score),...await operational('FJ','events',actor,['eventsRead','eventsWrite'],['memberSigla','scheduleSigla'],[],'#/schedule'),...await operational('FH','labels',actor,['labelsRead','labelsWrite'],[],['staffSiglas'],'#/labels'),...await operational('FG','checklists',actor,['checklistRead','checklistWrite'],['responsibleSigla','checkerSigla'],[],'#/checklist'),...await notifications(actor)];
  return rows.filter(r=>canReadRecord(actor,r));
 },async monthlySnapshot(actor,period){
  const units=await monthlyAccess(actor);
  const missingSources=[],indicators=[],omittedIndicators=[],revisions=[];
  const previous=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5))-2,1)).toISOString().slice(0,7);
  const snapshots=await stores.FC.getMany(units.flatMap(id=>[[`qmentumUnits/${id}/months`,period],[`qmentumUnits/${id}/months`,previous]]));
  const validMonth=(row,unitId,month)=>row?.schemaVersion===1&&row.unitId===unitId&&row.period===month&&['REVIEWED','CLOSED'].includes(row.status)&&Number.isSafeInteger(row.version);
  const validResult=(value,id,row)=>value?.indicatorId===id&&value.status==='VALID'&&value.sourceMode==='CALCULATED'&&value.definitionVersion===row.definitionVersion&&value.inputVersion===row.version&&Number.isFinite(value.ratio)&&value.ratio>=0&&value.ratio<=1;
  for(const [i,unitId] of units.entries()){
   const [current,old]=snapshots.slice(i*2,i*2+2);
   if(!validMonth(current,unitId,period)){missingSources.push('FC.QMENTUM.'+unitId);continue;}
   revisions.push([unitId,current.version,Number(current.updatedAt)||0,old?.version||0]);
   for(const {id,name} of QMENTUM_INDICATORS){
    const key=unitId+'.'+id,value=current.results?.[id],prior=old?.results?.[id];
    if(!validResult(value,id,current)){omittedIndicators.push({id:key,status:value?.status||'MISSING'});continue;}
    const comparable=validMonth(old,unitId,previous)&&validResult(prior,id,old)&&prior.definitionVersion===value.definitionVersion&&prior.populationKey===value.populationKey;
    indicators.push({id:key,label:`${name} (${unitId})`,unit:'%',value:value.ratio*100,target:value.targetValidated===true&&Number.isFinite(value.target)?value.target*100:null,previous:comparable?prior.ratio*100:null});
   }
  }
  const technicalMetrics=await performanceMetrics(stores.FD,period).catch(()=>[]);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({period,revisions,indicators,omittedIndicators,technicalMetrics}))),signature=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return {schemaVersion:1,source:'FC',period,signature,units,complete:units.length>0&&missingSources.length===0&&indicators.length>0,missingSources,updatedAt:Math.max(0,...revisions.map(r=>r[2])),indicators,omittedIndicators,technicalMetrics};
 }};
}
