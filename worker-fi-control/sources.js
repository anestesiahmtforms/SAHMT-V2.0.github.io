import {canReadRecord,normalize} from './fi-ai-policy.js';
import {documentGroupsFromAccess} from '../src/document-access.js';
export const SOURCE_COLLECTIONS=Object.freeze({FA:['users','documentAccessEmails','accessRequests','appConfig','userCategories'],FB:['users','documents','scopedDocuments','managementAreas','documentAccessEmails','trainings','learningActivities'],FC:['users','occurrenceReports'],FD:['users','indicatorSnapshots'],FF:['users','communicationMessages'],FG:['users','checklists'],FH:['users','labels'],FJ:['users','contacts','events']});
const admin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
const permission=(p,...names)=>admin(p)||names.some(n=>p?.permissions?.[n]===true);
const eq=(field,value)=>({field,op:'EQUAL',value});
const own=r=>r.active!==false&&r.deleted!==true&&r.sheetDeleted!==true;
const version=r=>String(r.version||r.updatedAt||r.createdAt||'1');
const compact=(...v)=>v.filter(x=>typeof x==='string'&&x.trim()).join(' · ').slice(0,5000);
function preview(value){try{const u=new URL(value),m=u.pathname.match(/^\/(?:file|document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/);if(u.protocol==='https:'&&!u.username&&!u.password&&m&&['drive.google.com','docs.google.com'].includes(u.hostname))return u.origin+u.pathname.slice(0,u.pathname.indexOf(m[1])+m[1].length)+'/preview';}catch{}return '';}
export function createFiSourceProvider({stores,resolveIdentity,now=Date.now}={}){
 const coverage=[];
 async function identity(source,actor){
  if(resolveIdentity)return resolveIdentity(source,actor);
  const store=stores[source];if(!store)return null;
  const rows=await store.list('users',[eq('email',actor.email)],3);
  if(rows.length!==1)return null;const p=rows[0];
  return p.uid===p.id&&String(p.email||'').toLowerCase()===actor.email&&p.active===true&&p.access===true?p:null;
 }
 const record=(source,collection,row,details)=>({schemaVersion:1,id:`${source}.${collection}.${row.id}`,source,active:row.active!==false,title:row.title||'',text:'',url:'#/home',version:version(row),sourceAccess:'EXPLICIT',...details});
 async function scope(source,fn){
  if(!stores[source]){coverage.push({source,status:'NOT_CONFIGURED'});return [];}
  try{const value=await fn(stores[source]);coverage.push({source,status:'AVAILABLE'});return value;}catch{coverage.push({source,status:'UNAVAILABLE'});return [];}
 }
 async function documents(actor){return scope('FB',async fb=>{
  const p=await identity('FB',actor);if(!p||!permission(p,'managementRead','trainingsRead'))return [];
  const fa=stores.FA;if(!fa)return [];const gate=await fa.get('users',actor.uid);
  if(!gate||gate.active!==true||gate.access!==true||String(gate.email||'').toLowerCase()!==actor.email||!permission(gate,'managementRead','trainingsRead'))return [];
  const manager=permission(gate,'documentsManage','managementManage','qualityManage');
  const access=await fa.get('documentAccessEmails',actor.email),groups=manager?['GENERAL','RESTRICTED']:documentGroupsFromAccess(access?{...access,id:actor.email}:null,actor.email);
  const rows=[];
  for(const collection of ['documents','scopedDocuments']){
   const docs=await fb.list(collection,[],301);
   for(const d of docs){
    if(d.deleted===true||d.trashed===true)continue;
    const legacyRestricted=/DOCUMENTOS? ADMINISTRATIV|ORGANOGRAMA/.test(normalize(d.category))||/ORGANOGRAMA/.test(normalize(d.title));
    if(collection==='scopedDocuments'&&!['GENERAL','RESTRICTED'].includes(d.audienceGroup))continue;
    const audience=legacyRestricted||d.audienceGroup==='RESTRICTED'?'RESTRICTED':'GENERAL';
    if(audience==='RESTRICTED'&&(!groups.includes('RESTRICTED')||!actor.memberCategories?.includes('EFETIVO')))continue;
    if(collection==='scopedDocuments'&&!groups.includes(audience))continue;
    const area=d.managementAreaId?await fb.get('managementAreas',d.managementAreaId):null;
    // Only passive previews may be opened from search; forms/quizzes never become actionable.
    const url=preview(d.materialPdfUrl||d.driveUrl);
    rows.push(record('FB',collection,d,{kind:'document',audience,category:d.category||'GENERAL',folderActive:area?.active!==false,sourceAllowedUids:[actor.uid],title:String(d.title||'Documento'),text:compact(d.title,d.description,d.category),url}));
   }
  }
  if(permission(p,'trainingsRead')&&permission(gate,'trainingsRead')){
   for(const d of await fb.list('trainings',[],301)){
    if(d.deleted===true||d.trashed===true)continue;
    rows.push(record('FB','trainings',d,{kind:'general',audience:'GENERAL',sourceAllowedUids:[actor.uid],text:compact(d.title,d.description),url:''}));
   }
   for(const d of await fb.list('learningActivities',[],301)){
    if(d.deleted===true||d.trashed===true||!['ACTIVE','INACTIVE'].includes(d.status))continue;
    const audience=d.audienceType==='ALL'&&d.audienceValue===''||d.audienceType==='ROLE'&&d.audienceValue===p.role||d.audienceType==='USER'&&d.audienceValue===p.uid;
    if(!audience)continue;
    rows.push(record('FB','learningActivities',d,{kind:'general',audience:'GENERAL',active:d.status==='ACTIVE',sourceAllowedUids:[actor.uid],text:compact(d.title,d.description,d.category),url:preview(d.resourceUrl)}));
   }
  }
  coverage.push({source:'FB.documents',status:'CONTENT_NOT_INDEXED',detail:'Pesquisa em títulos e descrições, incluindo materiais inativos; o corpo integral dos arquivos ainda não foi indexado.'});return rows;
 });}
 async function operational(source,collection,actor,required,fields,arrayFields,route){return scope(source,async store=>{
  const p=await identity(source,actor);if(!p||!permission(p,...required))return [];
  const rows=new Map(),add=items=>items.forEach(r=>rows.set(r.id,r));
  add(await store.list(collection,[eq('createdByUid',p.uid)],101));
  const sigla=typeof p.sigla==='string'?p.sigla.trim().toUpperCase():'';
  if(/^(?:[A-Z]{2}|L2)$/.test(sigla)){
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
   const authored=r.createdByUid===p.uid,participates=!!sigla&&(fields.some(f=>r[f]===sigla)||arrayFields.some(f=>Array.isArray(r[f])&&r[f].includes(sigla)))||!!formalName&&r.substitute===formalName;
   if(!authored&&!participates)continue;
   result.push(record(source,collection,r,{kind:'operational',audience:'INVOLVED',sourceAllowedUids:[actor.uid],authorUid:authored?actor.uid:'',participantUids:participates?[actor.uid]:[],title:compact(source==='FJ'?'Evento operacional':source==='FG'?'Checklist':'Etiqueta',r.eventType,r.date),text:compact(r.date,r.eventType,r.description,r.condition,r.stationName,r.status),url:route}));
  }
  return result;
 });}
 async function notifications(actor){return scope('FF',async store=>{
  const p=await identity('FF',actor);if(!p)return [];
  const rows=await store.list('communicationMessages',[eq('audienceValue',p.uid)],101),result=[];
  for(const r of rows){
   if(r.audienceType!=='USER'||r.audienceValue!==p.uid||!own(r)||!['PUBLISHED','published'].includes(r.status)||r.expiresAt&&r.expiresAt<=now())continue;
   result.push(record('FF','communicationMessages',r,{kind:'notification',audience:'INVOLVED',sourceAllowedUids:[actor.uid],recipientUids:[actor.uid],title:String(r.title||'Notificação'),text:compact(r.title,r.description),url:'#/communications'}));
  }
  coverage.push({source:'FC.occurrenceReports',status:'INVOLVEMENT_MAPPING_REQUIRED',detail:'Notificações sem vínculo formal de envolvidos não são liberadas pela pesquisa.'});return result;
 });}
 return {coverage,async searchRecords(actor){
  coverage.length=0;
  const rows=[...await documents(actor),...await operational('FJ','events',actor,['eventsRead','eventsWrite'],['memberSigla','scheduleSigla'],[],'#/schedule'),...await operational('FH','labels',actor,['labelsRead','labelsWrite'],[],['staffSiglas'],'#/labels'),...await operational('FG','checklists',actor,['checklistRead','checklistWrite'],['responsibleSigla','checkerSigla'],[],'#/checklist'),...await notifications(actor)];
  return rows.filter(r=>canReadRecord(actor,r));
 },async monthlySnapshot(actor,period){
  if(!admin(actor.profile))throw Error('FORBIDDEN');
  const missingSources=[],indicators=[],omittedIndicators=[];const year=Number(period.slice(0,4)),previous=new Date(Date.UTC(year,Number(period.slice(5))-2,1)).toISOString().slice(0,7),snapshots=[];
  if(!stores.FD)return {schemaVersion:1,source:'FD',period,complete:false,missingSources:['FD'],indicators:[]};
  const p=await identity('FD',actor);if(!p||!permission(p,'managementIndicatorsRead','managementIndicatorsWrite'))throw Error('SOURCE_FORBIDDEN');
  for(const platform of ['management','records','surveys','operations']){
   let snapshot;try{snapshot=await stores.FD.get('indicatorSnapshots',`${year}_${platform}`);}catch{}
   if(snapshot?.schemaVersion!==1||snapshot.year!==year||snapshot.platform!==platform||snapshot.status!=='AVAILABLE'||!Array.isArray(snapshot.metrics)){missingSources.push('FD.'+platform);continue;}
   snapshots.push(snapshot);
   for(const metric of snapshot.metrics){
    if(metric.cadence!=='MONTHLY')continue;
    const value=metric.months?.find(m=>m.period===period),old=metric.months?.find(m=>m.period===previous);
    if(value?.status!=='VALID'||!Number.isFinite(value.value)){omittedIndicators.push({id:metric.id,status:value?.status||'MISSING'});continue;}
    indicators.push({id:metric.id,label:metric.title,unit:metric.unit,value:value.value,target:Number.isFinite(metric.target)?metric.target:null,previous:old?.status==='VALID'&&Number.isFinite(old.value)?old.value:null});
   }
  }
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({period,snapshots}))),signature=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return {schemaVersion:1,source:'FD',period,signature,complete:missingSources.length===0&&indicators.length>0,missingSources,updatedAt:Math.max(0,...snapshots.map(s=>Number(s.checkedAt)||0)),indicators,omittedIndicators,technicalMetrics:[]};
 }};
}
