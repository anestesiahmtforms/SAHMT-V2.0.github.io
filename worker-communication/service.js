import {localDateKey} from '../src/schedule-date.js';
import {resolveChecklistRotationCore} from '../src/checklist-rotation-core.js';
import {createHash} from 'node:crypto';
import {FF,adminIdentity,activeProfile,id,text,fail,validateMessage,isCurrentMessage,matches,PAGE_SIZE,BATCH_SIZE,CATEGORIES,safePreview,automaticNoticePreview,BUILTIN_GROUPS} from '../communication/domain.js';
import {assignedInstitutionalGroup} from '../src/institutional-group.js';
import {communicationSenderRole,operationalNoticeIdentity,urgentNoticeInput,RELEASE_NOTICE,scheduleReleaseIdentity} from '../src/communication-operational-notices.js';
import {COMMUNICATION_LIMITS,communicationUsagePeriod} from '../src/communication-usage.js';
import {isSystemOwnerEmail} from '../src/system-account-exclusions.js';
import {createObligationService} from './obligation-service.js';
import {validateObligation} from '../communication/obligations.js';
const digest=v=>createHash('sha256').update(v).digest('hex');
const counters=()=>({published:0,sent:0,devices:0,accepted:0,failed:0,unknown:0,categories:{}});
const actorData=a=>({uid:a.uid,sourceUid:a.sourceUid,email:a.email});
export function createCommunicationService({store,fa,scheduleSource=fa,send,recipientEnabled,pushQueue,history,historyDrive,activitySource,now=Date.now,uuid=()=>crypto.randomUUID()}){
 const audit=(tx,a,action,subject,detail={})=>tx.create('communicationAuditLogs',uuid(),{...actorData(a),at:now(),action,subject,detail});
 const admin=a=>{if(!adminIdentity(a))throw fail('COMM_FORBIDDEN',403);};
 const profile=async(uid,email)=>{
  id(uid);const rows=await store.page('users',{limit:2,filters:[['email',email]]});
  const p=rows[0];if(rows.length!==1||!activeProfile(p)||typeof p.uid!=='string'||p.uid!==p.id||p.email!==email||p.ffUid&&p.ffUid!==uid)throw fail('COMM_FORBIDDEN',403);
  return p;
 };
 const readActions=new Set(['BOOTSTRAP','INBOX','MESSAGE','SENT_MESSAGES','SENT_DETAIL','ACTIVITY_CATALOG','PENDING_ACTIVITIES','MESSAGES','GROUPS','HISTORY','DIRECTORY','PUSH_DEVICE_DIRECTORY','PUSH_TEAM_STATUS','METRICS','SETTINGS','AREAS','AUDIT','IMPORT_SOURCE','USAGE']);
 const quota=(code,used,limit,resetsAt)=>Object.assign(fail(code,429),{used,limit,...(resetsAt?{resetsAt}:{})});
 async function admit(a,action){
  const {day,resetsAt}=communicationUsagePeriod(now()),minute=Math.floor(now()/60000),key=digest(a.uid);
  await store.transaction(async tx=>{
   const d=await tx.get('communicationBudgets',day)||{requests:0},u=await tx.get('communicationRateLimits',key)||{};
   if(action!=='USAGE'&&d.requests>=COMMUNICATION_LIMITS.dailyOperations)throw quota('COMM_DAILY_OPERATION_LIMIT',d.requests,COMMUNICATION_LIMITS.dailyOperations,resetsAt);
   if(u.minute===minute&&u.count>=COMMUNICATION_LIMITS.minuteOperations)throw quota('COMM_RATE_LIMIT',u.count,COMMUNICATION_LIMITS.minuteOperations,(minute+1)*60000);
   const kind=readActions.has(action)?'reads':'changes';
   tx.set('communicationBudgets',day,{...d,requests:d.requests+1,[kind]:(d[kind]||0)+1,at:now()});
   tx.set('communicationRateLimits',key,{minute,count:u.minute===minute?u.count+1:1});
  });
 }
 async function usage(){
  const period=communicationUsagePeriod(now()),[operations,publications]=await Promise.all([store.get('communicationBudgets',period.day),store.get('communicationPublicationBudgets',period.day)]);
  const published=Number.isSafeInteger(publications?.published)?publications.published:await store.countPublished(period.startsAt,period.resetsAt);
  const used=operations?.requests||0,reads=operations?.reads||0,changes=operations?.changes||0;
  return {day:period.day,resetsAt:period.resetsAt,operations:{used,limit:COMMUNICATION_LIMITS.dailyOperations,reads,changes,unclassified:Math.max(0,used-reads-changes)},publications:{used:published,limit:COMMUNICATION_LIMITS.dailyPublications,remaining:Math.max(0,COMMUNICATION_LIMITS.dailyPublications-published)},minuteLimit:COMMUNICATION_LIMITS.minuteOperations};
 }
 async function audience(m,p,localUid){
  if(isSystemOwnerEmail(p?.email))return false;
  if(m.history&&!m.historyLegacy){const snapshot=await store.get('communicationMessageRecipients',m.id);return activeProfile(p)&&snapshot?.items?.some(item=>item.uid===localUid)===true;}
  if(m.audienceType==='GROUP'){
   if(BUILTIN_GROUPS.some(g=>g.id===m.audienceValue))return activeProfile(p)&&p.institutionalGroup===m.audienceValue.slice('institutional-'.length);
   const g=await store.get('communicationGroups',m.audienceValue);
   return matches(m,localUid,p,g?.active===true?g.memberUids:[]);
  }
  if(m.audienceType==='AREA'){
   const area=await store.get('managementAreas',m.audienceValue);
   return area?.active===true&&matches(m,localUid,p,[...(area.memberUids||[]),...(area.managerUids||[])]);
  }
  return matches(m,localUid,p);
 }
 const paged=rows=>({items:rows.slice(0,PAGE_SIZE),cursor:rows.length>PAGE_SIZE?rows[PAGE_SIZE-1].id:null});
 async function resolveRecipients({audience:selection,recipient}={}){
  const rows=await store.eligibleRecipients();
  return rows.filter(p=>p.uid===p.id&&activeProfile(p)&&!isSystemOwnerEmail(p.email)&&
   (selection==='ALL'||selection==='USER'&&p.uid===recipient||selection===`institutional-${p.institutionalGroup}`));
 }
 async function messageRecipients(m){
  if(['ALL','USER'].includes(m.audienceType)||m.audienceType==='GROUP'&&BUILTIN_GROUPS.some(g=>g.id===m.audienceValue))return resolveRecipients({audience:m.audienceType==='GROUP'?m.audienceValue:m.audienceType,recipient:m.audienceValue});
  const rows=await store.eligibleRecipients();
  const group=m.audienceType==='GROUP'?await store.get('communicationGroups',m.audienceValue):null;
  const area=m.audienceType==='AREA'?await store.get('managementAreas',m.audienceValue):null;
  const members=group?.active===true?group.memberUids:area?.active===true?[...(area.memberUids||[]),...(area.managerUids||[])]:[];
  return rows.filter(person=>person.id===person.uid&&matches(m,person.uid,person,members));
 }
 async function rememberRelease(tx,uid,messageId,releaseAt){
  const prior=await tx.get('communicationReleaseInboxes',uid);
  if(!prior||Number(prior.releaseAt)<releaseAt)tx.set('communicationReleaseInboxes',uid,{messageId,releaseAt});
 }
 const obligations=history&&activitySource?createObligationService({
  store,source:activitySource,history,resolveRecipients,now,uuid,
  saveActivity:(input,a)=>saveMessage({
   id:input.id,version:0,message:{
    title:input.title,message:input.description,category:'ENQUETES E CONSULTAS',priority:'HIGH',
    audienceType:input.audienceType,audienceValue:input.audienceValue,route:'home',
    status:'published',publishAt:now(),expiresAt:now()+365*86400000
   }
  },a,{activityInput:input})
 }):null;
 async function saveMessage(input,a,{event=false,release=false,releaseAt=0,releaseDevices=null,activityInput=null}={}){
  const key=input.id?id(input.id):uuid(),m=validateMessage(input.message,now());
  if(activityInput){m.activity=validateObligation(activityInput.activity);m.hasActivity=true;}
  if((!event&&key.startsWith('event-'))||(!release&&key.startsWith('release-'))||(!activityInput&&key.startsWith('activity-')))throw fail('COMM_INVALID_ID');
  let individual;
  if(!event&&!activityInput&&m.audienceType==='USER'){individual=await store.get('users',m.audienceValue);if(!activeProfile(individual)||isSystemOwnerEmail(individual.email))throw fail('COMM_INVALID_AUDIENCE');}
  if((m.audienceType==='GROUP'&&!BUILTIN_GROUPS.some(g=>g.id===m.audienceValue))||m.audienceType==='AREA'){const g=await store.get(m.audienceType==='GROUP'?'communicationGroups':'managementAreas',m.audienceValue);if(g?.active!==true)throw fail('COMM_INVALID_AUDIENCE');}
  if(input.source)throw fail('COMM_SOURCE_UNSUPPORTED');const source=null;
  const recipients=history&&m.status==='published'?(activityInput?.recipients||(release?[individual]:await messageRecipients(m))):null;
  const saved=await store.transaction(async tx=>{
   const old=await tx.get('communicationMessages',key),dispatch=await tx.get('communicationDispatches',key);
   if((event||release||activityInput)&&old){
    const sameNotice=old.status==='published'&&(release||old.createdBy?.sourceUid===a.sourceUid||event&&key.startsWith('event-checklist-conference-'))&&
     ['title','message','audienceType','audienceValue'].every(field=>old[field]===m[field])&&(!activityInput||old.previewId===activityInput.previewId&&old.fingerprint===activityInput.fingerprint&&JSON.stringify(old.activity)===JSON.stringify(m.activity));
    if(!sameNotice)throw fail('COMM_CONFLICT',409);
    if(release)await rememberRelease(tx,m.audienceValue,key,releaseAt);
    const mayStart=release&&dispatch&&dispatch.status!=='completed'&&isCurrentMessage(old,now())&&
     (dispatch.enqueueStatus==='retry'||dispatch.enqueueStatus==='starting'&&dispatch.enqueueStartedAt<=now()-60000);
    const nextDispatch=mayStart?{...dispatch,enqueueStatus:'starting',enqueueStartedAt:now()}:dispatch;
    if(mayStart)tx.set('communicationDispatches',key,nextDispatch);
    const settings=release?await tx.get('communicationSettings','main'):null;
    return {message:old,dispatch:nextDispatch,alreadySent:true,startPush:mayStart,...(release?{pushEnabled:settings?.pushEnabled===true}:{})};
   }
   if(dispatch)throw fail('COMM_MESSAGE_LOCKED',409);
   if(old?.history)throw fail('COMM_MESSAGE_LOCKED',409);
   if((old?.version||0)!==input.version)throw fail('COMM_CONFLICT',409);
   if(event&&m.audienceType==='USER'){
    const recipient=await tx.get('users',m.audienceValue);
    if(!activeProfile(recipient)||isSystemOwnerEmail(recipient.email)||!BUILTIN_GROUPS.some(group=>group.id===`institutional-${recipient.institutionalGroup}`))throw fail('COMM_INVALID_AUDIENCE');
   }
   const firstPublish=m.status==='published'&&!old?.firstPublishedAt;
   const period=communicationUsagePeriod(now()),daily=firstPublish?await tx.get('communicationPublicationBudgets',period.day):null;
   const published=firstPublish?(Number.isSafeInteger(daily?.published)?daily.published:await tx.countPublished(period.startsAt,period.resetsAt)):null;
   if(firstPublish&&published>=COMMUNICATION_LIMITS.dailyPublications)throw quota('COMM_DAILY_PUBLICATION_LIMIT',published,COMMUNICATION_LIMITS.dailyPublications,period.resetsAt);
   const month=new Date(now()).toISOString().slice(0,7);
   const total=firstPublish?(await tx.get('communicationMetrics','total')||counters()):null;
   const monthly=firstPublish?(await tx.get('communicationMetrics',month)||counters()):null;
   const record={...m,id:key,version:(old?.version||0)+1,createdAt:old?.createdAt||now(),createdBy:old?.createdBy||actorData(a),updatedAt:now(),updatedBy:actorData(a),firstPublishedAt:old?.firstPublishedAt||(firstPublish?now():null),source:source?.reference||old?.source||null};
   if(activityInput){record.previewId=activityInput.previewId;record.fingerprint=activityInput.fingerprint;}
   if(firstPublish&&history){
    record.history=await history.reserve(tx,record,recipients);
    if(!activityInput)record.historyArchiveAfter=record.expiresAt;
   }
   if(firstPublish&&activityInput)await obligations.reserveIndex(tx,record,recipients);
   if(release)await rememberRelease(tx,m.audienceValue,key,releaseAt);
   tx.set('communicationMessages',key,record);
   const settings=release?await tx.get('communicationSettings','main'):null;
   const automaticDispatch=release&&m.status==='published'&&settings?.pushEnabled===true?{id:key,messageId:key,title:m.title,category:m.category,audienceType:m.audienceType,audienceValue:m.audienceValue,author:actorData(a),createdAt:now(),status:releaseDevices?'processing':'queueing',cursor:'',version:record.version,processed:0,accepted:0,failed:0,skipped:0,unknown:0,batches:0,pendingCount:releaseDevices?.length??1,automatic:true,enqueueStatus:'starting',enqueueStartedAt:now(),...(releaseDevices?{directDeviceIds:releaseDevices}:{})}:null;
   if(automaticDispatch)tx.create('communicationDispatches',key,automaticDispatch);
   if(firstPublish)for(const [k,v]of [['total',total],[month,monthly]]){v.published++;v.categories[m.category]=(v.categories[m.category]||0)+1;tx.set('communicationMetrics',k,v);}
   if(firstPublish)tx.set('communicationPublicationBudgets',period.day,{published:published+1,at:now()});
   audit(tx,a,old?'MESSAGE_EDITED':'MESSAGE_CREATED',key,{version:record.version,status:m.status,...(history?{history:record.history||null}:{record}),automaticPush:Boolean(automaticDispatch)});return {message:record,dispatch:automaticDispatch,...(release?{pushEnabled:settings?.pushEnabled===true}:{}),...(firstPublish?{publicationUsage:{used:published+1,limit:COMMUNICATION_LIMITS.dailyPublications,resetsAt:period.resetsAt}}:{})};
  });
  if(release&&saved.dispatch){
   if(saved.alreadySent&&!saved.startPush){
    const pushPending=saved.dispatch.enqueueStatus==='starting'&&saved.dispatch.status!=='completed'&&isCurrentMessage(saved.message,now());
    const pushQueued=(!saved.dispatch.enqueueStatus||saved.dispatch.enqueueStatus==='queued')||saved.dispatch.status==='completed';
    return {...saved,pushPending,pushQueued};
   }
   let pushQueued=false;
   try{
    const devices=saved.dispatch.directDeviceIds;
    if(devices)await pushQueue.sendBatch(devices.map(deviceId=>({body:{kind:'device',dispatchId:key,deviceId}})));
    else await pushQueue.send({kind:'fanout',dispatchId:key,cursor:''});
    pushQueued=true;
   }catch{}
   if(history&&saved.message.history)saved.syncQueued=await history.afterPublish(saved.message);
   await store.transaction(async tx=>{
    const dispatch=await tx.get('communicationDispatches',key);
    if(dispatch?.enqueueStatus==='starting'&&dispatch.enqueueStartedAt===saved.dispatch.enqueueStartedAt)tx.set('communicationDispatches',key,{...dispatch,enqueueStatus:pushQueued?'queued':'retry'});
   }).catch(()=>{});
   return {...saved,pushQueued,pushPending:!pushQueued};
  }
  if(history&&saved.message.history)saved.syncQueued=await history.afterPublish(saved.message);
  return {...saved,pushQueued:false};
 }
 function createEvent(input,a){
  const key=id(input.id),audience=input.audience;
  if(!key.startsWith('event-'))throw fail('COMM_INVALID_ID');
  if(!['ALL','USER'].includes(audience)&&!BUILTIN_GROUPS.some(group=>group.id===audience))throw fail('COMM_INVALID_AUDIENCE');
  const publishAt=now();
  return saveMessage({id:key,version:0,message:{
   title:input.title,message:input.description,category:'COMUNICADO GERAL',priority:'NORMAL',
   audienceType:['ALL','USER'].includes(audience)?audience:'GROUP',
   audienceValue:audience==='ALL'?'':audience==='USER'?id(input.recipient):audience,
   route:'home',status:'published',publishAt,expiresAt:publishAt+7*86400000,
  }},a,{event:true});
 }
 async function urgentNotice(input,a){
  const fixed=urgentNoticeInput({noticeId:input.id||`urgent-${uuid()}`,title:input.message?.title,message:input.message?.message},now());
  try{return await saveMessage(fixed,a);}
  catch(error){
   if(!['COMM_CONFLICT','COMM_MESSAGE_LOCKED'].includes(error.code))throw error;
   const old=await store.get('communicationMessages',fixed.id);
   if(old?.status!=='published'||old.createdBy?.sourceUid!==a.sourceUid||old.title!==fixed.message.title||old.message!==fixed.message.message||old.audienceType!=='ALL'||old.category!=='AVISO URGENTE'||old.priority!=='URGENT')throw error;
   return {message:old,dispatch:null,pushQueued:false,alreadySent:true};
  }
 }
 async function releaseNotice(input,a){
  if(!a.faUid)throw fail('COMM_SESSION_INVALID',401);
  const faProfile=await fa.get('users',id(a.faUid));
  if(faProfile?.uid!==a.faUid||faProfile.email?.toLowerCase()!==a.email||!scheduleReleaseIdentity(faProfile,a))throw fail('COMM_FORBIDDEN',403);
  const day=String(input.day||''),sigla=String(input.sigla||'').trim().toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||! /^(?:[A-Z]{2}|L2)$/.test(sigla))throw fail('COMM_INVALID_INPUT');
  if(day!==localDateKey(new Date(now())))throw fail('COMM_NOT_CURRENT',409);
  const schedule=await scheduleSource.get('scheduleDays',day),releaseAt=Number(schedule?.highlights?.releaseTimes?.[sigla]);
  if(!schedule||!Array.isArray(schedule.highlights?.siglas)||!schedule.highlights.siglas.includes(sigla)||!Number.isSafeInteger(releaseAt)||releaseAt<=0||releaseAt>now()+60000)throw fail('COMM_NOT_CURRENT',409);
  const people=await store.page('users',{limit:2,filters:[['sigla',sigla],['active',true],['access',true]],fields:['uid','email','displayName','sigla','active','access']});
  if(people.length!==1||typeof people[0].uid!=='string'||isSystemOwnerEmail(people[0].email))throw fail('COMM_INVALID_AUDIENCE',409);
  const devices=await store.page('communicationDevices',{limit:6,filters:[['sourceUid',people[0].uid],['active',true]],fields:['updatedAt']});
  const pushEligible=devices.length>0;
  const releaseDevices=pushEligible&&devices.length<=5?devices.map(device=>device.id):null;
  const key=`release-${day}-${sigla}-${releaseAt}`;
  const result=await saveMessage({id:key,version:0,message:{...RELEASE_NOTICE,category:'INFORMAÇÃO INSTITUCIONAL',priority:'HIGH',audienceType:'USER',audienceValue:people[0].uid,route:'home',publishAt:now(),expiresAt:now()+7*86400000,status:'published'}},a,{release:true,releaseAt,releaseDevices});
  return {...result,pushEligible};
 }
 async function sendChecklistConference(day){
  if(typeof scheduleSource.checklistRotationInputs!=='function'||day!==localDateKey(new Date(now())))throw fail('COMM_NOT_CURRENT',409);
  const idValue=`event-checklist-conference-${day}`;
  const inputs=await scheduleSource.checklistRotationInputs(day),selection=resolveChecklistRotationCore({schedule:inputs.schedule,day,vacations:inputs.vacations,truncated:inputs.truncated});
  if(!selection.complete||!selection.sigla)throw fail('COMM_CHECKLIST_ROTATION_UNAVAILABLE',503);
  const people=await store.page('users',{limit:2,filters:[['sigla',selection.sigla],['active',true],['access',true]],fields:['uid','email','displayName','sigla','institutionalGroup','active','access']});
  if(people.length!==1||people[0].uid!==people[0].id||!activeProfile(people[0])||people[0].sigla!==selection.sigla||isSystemOwnerEmail(people[0].email))throw fail('COMM_INVALID_AUDIENCE',409);
  const actor={uid:'automatic-checklist-conference',sourceUid:'automatic-checklist-conference',email:'automacao-checklist@sahmt.app'};
  const result=await createEvent({id:idValue,title:'Conferencia do Checklist',description:'Não se esqueça! Você é o escalado para a conferencia dos checklists de hoje. Obrigado',audience:'USER',recipient:people[0].uid},actor);
  return {sent:!result.alreadySent,alreadySent:Boolean(result.alreadySent),id:idValue,recipient:selection.sigla};
 }
 async function device(input,a,enable){
  if(typeof input.token!=='string'||input.token.length<50||input.token.length>4096||/\s/.test(input.token))throw fail('COMM_INVALID_TOKEN');
  const key=digest(input.token);
  const incomingId=typeof input.deviceId==='string'&&/^[a-f0-9-]{36}$/.test(input.deviceId)?input.deviceId:'';
  const own=enable?await store.page('communicationDevices',{limit:6,filters:[['uid',a.uid],['active',true]]}):[];
  const sameInstallation=d=>incomingId&&d.deviceId===incomingId&&d.sourceUid===a.sourceUid&&d.googleUid===a.googleUid;
  if(enable&&own.filter(d=>d.id!==key&&!sameInstallation(d)).length>=5)throw fail('COMM_DEVICE_LIMIT',409);
  return store.transaction(async tx=>{
   const old=await tx.get('communicationDevices',key),metrics=await tx.get('communicationMetrics','total')||counters(),recipient=await tx.get('communicationRecipients',a.uid);
   const deviceIds=[],superseded=[];
   const known=new Set([...(recipient?.deviceIds||[]),...own.map(d=>d.id)]);
   known.delete(key);
   for(const previousId of known){
    const previous=await tx.get('communicationDevices',previousId);
    if(previous?.active===true&&previous.uid===a.uid){
     if(enable&&sameInstallation(previous))superseded.push(previous);
     else deviceIds.push(previousId);
    }
   }
   if(enable&&deviceIds.length>=5)throw fail('COMM_DEVICE_LIMIT',409);
   if(old&&old.uid!==a.uid)throw fail('COMM_DEVICE_OWNER',403);
   if(!enable&&!old)return {registered:false};
   const wasActive=old?.active===true;
   const deviceId=incomingId||old?.deviceId||'';
   const displayMode=['browser','standalone'].includes(input.displayMode)?input.displayMode:old?.displayMode||'';
   tx.set('communicationDevices',key,{id:key,uid:a.uid,sourceUid:a.sourceUid,email:a.email,googleUid:a.googleUid,token:input.token,active:enable,platform:String(input.platform||old?.platform||'').slice(0,60),deviceId,displayMode,updatedAt:now()});
   for(const previous of superseded)tx.set('communicationDevices',previous.id,{...previous,active:false,updatedAt:now()});
   const deviceDelta=Number(enable)-Number(wasActive)-superseded.length;
   if(deviceDelta){metrics.devices=Math.max(0,metrics.devices+deviceDelta);tx.set('communicationMetrics','total',metrics);}
   tx.set('communicationRecipients',a.uid,{...actorData(a),googleUid:a.googleUid,verifiedAt:now(),deviceIds:enable?[...deviceIds,key]:deviceIds});
   audit(tx,a,enable?'DEVICE_REGISTERED':'DEVICE_DISABLED',key);return {registered:enable};
  });
 }
 async function pushDeviceDirectory(input){
  const rows=await store.page('users',{cursor:input.cursor||'',limit:9,filters:[['active',true],['access',true]],fields:['uid','email','displayName','sigla','active','access']});
  const users=rows.slice(0,8),items=[];
  for(const user of users){
   const sourceUid=user.uid||user.id;
   const [installations,pushRows]=await Promise.all([
    store.page('communicationInstallations',{limit:21,filters:[['sourceUid',sourceUid]]}),
    store.page('communicationDevices',{limit:21,filters:[['sourceUid',sourceUid]],fields:['active','deviceId','platform','displayMode','updatedAt']})
   ]);
   const active=pushRows.filter(d=>d.active===true),known=new Set(installations.map(d=>d.deviceId));
   const devices=installations.map(d=>({deviceId:d.deviceId,platform:d.platform||'Outro',displayMode:d.displayMode||'',appVersion:d.appVersion||'',loadedRelease:d.loadedRelease||0,lastSeenAt:d.lastSeenAt||0,pushStatus:active.some(p=>p.deviceId===d.deviceId)?'ACTIVE':'NOT_REGISTERED',pushUpdatedAt:Math.max(0,...pushRows.filter(p=>p.deviceId===d.deviceId).map(p=>p.updatedAt||0))}));
   for(const push of active.filter(p=>!known.has(p.deviceId)))devices.push({deviceId:push.deviceId||'',platform:push.platform||'Outro',displayMode:push.displayMode||'',appVersion:'',loadedRelease:0,lastSeenAt:push.updatedAt||0,pushStatus:push.deviceId?'ACTIVE':'UNLINKED',pushUpdatedAt:push.updatedAt||0});
   items.push({uid:sourceUid,displayName:user.displayName||'',email:user.email||'',sigla:user.sigla||'',devices});
  }
  return {items,cursor:rows.length>8?users.at(-1)?.id||null:null};
 }
 const isEffective=profile=>activeProfile(profile)&&profile.institutionalGroup==='team'&&!isSystemOwnerEmail(profile.email);
 async function hasActivePush(sourceUid,deviceId=''){
  const devices=await store.page('communicationDevices',{limit:6,filters:[['sourceUid',sourceUid],['active',true]],fields:['deviceId','updatedAt']});
  return devices.some(device=>(!deviceId||device.deviceId===deviceId)&&Number.isFinite(device.updatedAt)&&device.updatedAt>=now()-30*86400000);
 }
 async function pushTeamStatus(input){
  if(Object.keys(input).length!==1||!Array.isArray(input.uids)||!input.uids.length||input.uids.length>8||
     new Set(input.uids).size!==input.uids.length)throw fail('COMM_INVALID_INPUT');
  const uids=input.uids.map(id);
  const profiles=await store.getMany('users',uids);
  const items=await Promise.all(profiles.map(async (profile,index)=>{
   const uid=uids[index];
   return {uid,active:profile?.uid===uid&&isEffective(profile)?await hasActivePush(uid):null};
  }));
  return {items};
 }
 async function presence(value,a){
  if(!value||typeof value.deviceId!=='string'||!/^[-a-f0-9]{36}$/.test(value.deviceId))return;
  const key=digest(a.uid+':'+value.deviceId);
  await store.transaction(async tx=>{const prior=await tx.get('communicationInstallations',key);if(prior&&prior.lastSeenAt>now()-6*3600000&&prior.loadedRelease===value.loadedRelease)return;
   tx.set('communicationInstallations',key,{sourceUid:a.sourceUid,uid:a.uid,deviceId:value.deviceId,platform:String(value.platform||'Outro').slice(0,60),displayMode:['browser','standalone'].includes(value.displayMode)?value.displayMode:'',appVersion:String(value.appVersion||'').slice(0,30),loadedRelease:Number.isSafeInteger(value.loadedRelease)?value.loadedRelease:0,lastSeenAt:now()});});
 }
 async function prepare(input,a){
  const key=id(input.id);
  if(!key.startsWith('release-'))throw fail('COMM_PUSH_RELEASE_ONLY',403);
  return store.transaction(async tx=>{
   const m=await tx.get('communicationMessages',key),prior=await tx.get('communicationDispatches',key),settings=await tx.get('communicationSettings','main');
   if(!isCurrentMessage(m,now()))throw fail('COMM_NOT_CURRENT',409);
   if(settings?.pushEnabled!==true)throw fail('COMM_PUSH_DISABLED',409);
   if(prior)return {dispatch:prior};
   const d={id:key,messageId:key,title:m.title,category:m.category,audienceType:m.audienceType,audienceValue:m.audienceValue,author:actorData(a),createdAt:now(),status:'ready',cursor:'',version:m.version,processed:0,accepted:0,failed:0,skipped:0,unknown:0,batches:0};
   tx.create('communicationDispatches',key,d);audit(tx,a,'DISPATCH_PREPARED',key);return {dispatch:d};
  });
 }
 async function batch(input,a){
  const key=id(input.id);
  if(!key.startsWith('release-'))throw fail('COMM_PUSH_RELEASE_ONLY',403);
  if(input.confirmed!==true)throw fail('COMM_CONFIRMATION_REQUIRED');
  const d=await store.get('communicationDispatches',key);
  if(!d||d.status!=='ready')throw fail('COMM_DISPATCH_LOCKED',409);
  const filters=[['active',true],...(d.audienceType==='USER'?[['sourceUid',d.audienceValue]]:[])];
  const devices=await store.page('communicationDevices',{cursor:d.cursor,limit:BATCH_SIZE,filters});
  const batchId=uuid();
  const m=await store.transaction(async tx=>{
   const live=await tx.get('communicationDispatches',key),message=await tx.get('communicationMessages',key),settings=await tx.get('communicationSettings','main');
   if(live?.status!=='ready'||live.cursor!==d.cursor||live.batches!==input.batches)throw fail('COMM_DISPATCH_LOCKED',409);
   if(settings?.pushEnabled!==true)throw fail('COMM_PUSH_DISABLED',409);
   if(!isCurrentMessage(message,now())||message.version!==live.version)throw fail('COMM_NOT_CURRENT',409);
   tx.set('communicationDispatches',key,{...live,status:'processing',batchId,batchStartedAt:now(),pendingCount:devices.length,cursor:devices.at(-1)?.id||live.cursor,batches:live.batches+1});
   audit(tx,a,'DISPATCH_BATCH_CLAIMED',key,{batchId,devices:devices.map(x=>x.id)});return message;
  });
  const outcomes=[];
  for(const device of devices){
   let result={id:device.id,status:'skipped',disable:false};
   try{
    if(device.updatedAt<now()-30*86400000){result.disable=true;result.reason='STALE_DEVICE';}
    else{
     const p=await store.get('users',device.sourceUid);
     if(!activeProfile(p)||p.email?.toLowerCase()!==device.email||!await audience(m,p,device.sourceUid))result.reason='NOT_ELIGIBLE';
     else if(!await recipientEnabled(device)){result.disable=true;result.reason='ACCOUNT_DISABLED';}
     else result={...result,...await send(device.token,{communicationId:key,route:'home',...automaticNoticePreview(m)})};
    }
   }catch(e){result={...result,status:'unknown',reason:e.code==='COMM_FREE_QUOTA_EXHAUSTED'?'FREE_QUOTA_EXHAUSTED':'OUTCOME_UNCONFIRMED'};}
   outcomes.push(result);
  }
  return store.transaction(async tx=>{
   const live=await tx.get('communicationDispatches',key),total=await tx.get('communicationMetrics','total')||counters(),month=new Date(now()).toISOString().slice(0,7),monthly=await tx.get('communicationMetrics',month)||counters();
   if(live?.batchId!==batchId||live.status!=='processing')throw fail('COMM_DISPATCH_LOCKED',409);
   const disabling=[];for(const o of outcomes.filter(o=>o.disable)){const current=await tx.get('communicationDevices',o.id);if(current?.active===true&&current.updatedAt===devices.find(d=>d.id===o.id).updatedAt)disabling.push(current);}
   const delta={accepted:0,failed:0,skipped:0,unknown:0};for(const o of outcomes)delta[o.status]++;
   const completed=devices.length<BATCH_SIZE;
   const updated={...live,quotaBlocked:outcomes.some(o=>['PROVIDER_QUOTA','FREE_QUOTA_EXHAUSTED'].includes(o.reason)),status:completed?'completed':'ready',pendingCount:0,processed:live.processed+devices.length,...Object.fromEntries(Object.entries(delta).map(([k,n])=>[k,live[k]+n])),updatedAt:now()};
   tx.set('communicationDispatches',key,updated);
   for(const metric of [total,monthly]){metric.accepted+=delta.accepted;metric.failed+=delta.failed;metric.unknown+=delta.unknown;if(live.batches===1)metric.sent++;}
   total.devices=Math.max(0,total.devices-disabling.length);for(const device of disabling)tx.set('communicationDevices',device.id,{...device,active:false,updatedAt:now()});
   tx.set('communicationMetrics','total',total);tx.set('communicationMetrics',month,monthly);
   audit(tx,a,'DISPATCH_BATCH_FINISHED',key,{batchId,outcomes});return {dispatch:updated};
  });
 }
 async function claimQueueWork(collection,key){
  return store.transaction(async tx=>{const old=await tx.get(collection,key);if(old?.status==='done')return false;if(old?.status==='processing'&&old.startedAt>now()-120000)throw fail('COMM_QUEUE_RETRY',503);tx.set(collection,key,{...old,id:key,status:'processing',startedAt:now()});return old||{};});
 }
 async function queueFanout(input){
  const dispatchId=id(input.dispatchId),dispatch=await store.get('communicationDispatches',dispatchId),message=await store.get('communicationMessages',dispatchId);
  if(!dispatch||dispatch.automatic!==true||dispatch.status==='completed')return {done:true};
  const cursor=typeof input.cursor==='string'?input.cursor:'',pageKey=`${dispatchId}:${cursor||'first'}`;
  if(dispatch.status!=='queueing'&&!(await store.get('communicationPushFanoutPages',pageKey))?.reserved)throw fail('COMM_QUEUE_RETRY',503);
  let reservation=await claimQueueWork('communicationPushFanoutPages',pageKey);if(!reservation)return {done:true};
  try{
   const settings=await store.get('communicationSettings','main');
   if(!message||!isCurrentMessage(message,now())||settings?.pushEnabled!==true){await store.transaction(async tx=>{const live=await tx.get('communicationDispatches',dispatchId);if(live)tx.set('communicationDispatches',dispatchId,{...live,status:'completed',pendingCount:0,updatedAt:now()});const receipt=await tx.get('communicationPushFanoutPages',pageKey);if(receipt)tx.set('communicationPushFanoutPages',pageKey,{...receipt,status:'done'});});return {done:true};}
   if(!reservation.reserved){
    const page=await store.page('communicationDevices',{cursor,limit:BATCH_SIZE+1,filters:[['active',true],...(message.audienceType==='USER'?[['sourceUid',message.audienceValue]]:[])]});
    const devices=page.slice(0,BATCH_SIZE),hasMore=page.length>BATCH_SIZE,nextCursor=devices.at(-1)?.id||cursor;
    reservation=await store.transaction(async tx=>{
     const live=await tx.get('communicationDispatches',dispatchId),receipt=await tx.get('communicationPushFanoutPages',pageKey);if(!live||receipt?.status==='done')return null;if(receipt?.reserved)return receipt;
     const pendingCount=Math.max(0,live.pendingCount-1+devices.length+(hasMore?1:0)),reserved={...receipt,dispatchId,reserved:true,deviceIds:devices.map(device=>device.id),hasMore,nextCursor};
     tx.set('communicationPushFanoutPages',pageKey,reserved);
     tx.set('communicationDispatches',dispatchId,{...live,status:hasMore?'queueing':pendingCount?'processing':'completed',cursor:hasMore?nextCursor:live.cursor,pendingCount,updatedAt:now()});
     return reserved;
    });
    if(!reservation)return {done:true};
   }
   // Reserve counters before exposing jobs to concurrent consumers. Retries reuse this plan.
   const batch=reservation.deviceIds.map(deviceId=>({body:{kind:'device',dispatchId,deviceId,fanoutPageId:pageKey}}));if(reservation.hasMore)batch.push({body:{kind:'fanout',dispatchId,cursor:reservation.nextCursor}});
   if(batch.length)await pushQueue.sendBatch(batch);
   await store.transaction(async tx=>{
    const receipt=await tx.get('communicationPushFanoutPages',pageKey);if(receipt&&receipt.status!=='done')tx.set('communicationPushFanoutPages',pageKey,{...receipt,status:'done',count:reservation.deviceIds.length,at:now()});
   });
   return {done:!reservation.hasMore};
  }catch(error){await store.transaction(async tx=>{const receipt=await tx.get('communicationPushFanoutPages',pageKey);if(receipt?.status==='processing')tx.set('communicationPushFanoutPages',pageKey,{...receipt,status:'retry'});}).catch(()=>{});throw error;}
 }
 async function queueDevice(input,{lastAttempt=false}={}){
  const dispatchId=id(input.dispatchId),deviceId=id(input.deviceId),dispatch=await store.get('communicationDispatches',dispatchId),receiptId=`${dispatchId}:${deviceId}`;
  if(!dispatch||dispatch.automatic!==true||dispatch.status==='completed')return {done:true};
  if(input.fanoutPageId){const page=await store.get('communicationPushFanoutPages',id(input.fanoutPageId));if(page?.reserved!==true||page.dispatchId!==dispatchId||!page.deviceIds?.includes(deviceId))throw fail('COMM_QUEUE_RETRY',503);}
  else if(dispatch.status==='queueing'||dispatch.directDeviceIds&&!dispatch.directDeviceIds.includes(deviceId))throw fail('COMM_QUEUE_RETRY',503);
  if(!await claimQueueWork('communicationPushDeliveries',receiptId))return {done:true};
  try{
   const message=await store.get('communicationMessages',dispatchId),device=await store.get('communicationDevices',deviceId),settings=await store.get('communicationSettings','main');
   let outcome={status:'skipped',reason:'NOT_ELIGIBLE',disable:false};
   if(message&&device?.active===true&&settings?.pushEnabled===true&&isCurrentMessage(message,now())){
    const recipient=await store.get('users',device.sourceUid);
    if(activeProfile(recipient)&&recipient.uid===device.sourceUid&&recipient.email?.toLowerCase()===device.email&&await audience(message,recipient,device.sourceUid)&&await recipientEnabled(device)){
     if(device.updatedAt<now()-30*86400000)outcome={status:'failed',reason:'STALE_DEVICE',disable:true};
     else outcome=await send(device.token,{communicationId:dispatchId,route:'home',...automaticNoticePreview(message)});
    }
   }
   if(outcome.retryDelaySeconds&&!lastAttempt)throw Object.assign(fail('COMM_PUSH_RETRY',503),{retryDelaySeconds:outcome.retryDelaySeconds});
   await store.transaction(async tx=>{
    const live=await tx.get('communicationDispatches',dispatchId),receipt=await tx.get('communicationPushDeliveries',receiptId);if(!live||receipt?.status==='done')return;
    const status=['accepted','failed','skipped','unknown'].includes(outcome.status)?outcome.status:'unknown',pendingCount=Math.max(0,live.pendingCount-1),total=await tx.get('communicationMetrics','total')||counters(),month=new Date(now()).toISOString().slice(0,7),monthly=await tx.get('communicationMetrics',month)||counters();
    tx.set('communicationPushDeliveries',receiptId,{...receipt,status:'done',result:status,reason:outcome.reason||'',dispatchCreatedAt:live.createdAt??null,at:now()});
    tx.set('communicationDispatches',dispatchId,{...live,status:live.status==='queueing'?live.status:pendingCount?'processing':'completed',processed:live.processed+1,pendingCount,[status]:live[status]+1,updatedAt:now()});
    total[status]=(total[status]||0)+1;monthly[status]=(monthly[status]||0)+1;
    if(outcome.disable){const current=await tx.get('communicationDevices',deviceId);if(current?.active===true&&current.updatedAt===device.updatedAt){tx.set('communicationDevices',deviceId,{...current,active:false,updatedAt:now()});total.devices=Math.max(0,total.devices-1);}}
    tx.set('communicationMetrics','total',total);tx.set('communicationMetrics',month,monthly);
   });
   return {done:true,status:outcome.status};
  }catch(error){await store.transaction(async tx=>{const receipt=await tx.get('communicationPushDeliveries',receiptId);if(receipt?.status==='processing')tx.set('communicationPushDeliveries',receiptId,{...receipt,status:'retry'});}).catch(()=>{});throw error;}
 }
 async function consumePush(input,options){if(input?.kind==='history'){if(!history)throw fail('COMM_HISTORY_CONFIG_REQUIRED',503);return history.consume(input);}if(typeof input?.dispatchId==='string'&&!input.dispatchId.startsWith('release-'))return {done:true};if(!pushQueue)throw fail('COMM_PUSH_QUEUE_UNAVAILABLE',503);if(input?.kind==='fanout')return queueFanout(input);if(input?.kind==='device')return queueDevice(input,options);throw fail('COMM_INVALID_INPUT');}
 return {consumePush,sendChecklistConference,async execute(action,input,a){
  if(!input||Array.isArray(input)||typeof input!=='object')throw fail('COMM_INVALID_INPUT');
  const regular=new Set(['BOOTSTRAP','INBOX','MESSAGE','MESSAGE_READ','PENDING_ACTIVITIES','VERIFY_ACTIVITY','REGISTER_DEVICE','DISABLE_DEVICE','SCHEDULE_RELEASE_NOTICE']);
  if(!regular.has(action))admin(a);
  if(!regular.has(action)&&operationalNoticeIdentity(a)&&!['CREATE_EVENT','DIRECTORY','SAVE_MESSAGE'].includes(action))throw fail('COMM_FORBIDDEN',403);
  if(action==='SENT_MESSAGES'&&!communicationSenderRole(a.email))throw fail('COMM_FORBIDDEN',403);
  // Validate authorization before accessing directory, rate records or messages.
  const ownProfile=await profile(a.uid,a.email);a={...a,sourceUid:ownProfile.uid};await admit(a,action);
  if(['ACTIVITY_CATALOG','PREVIEW_ACTIVITY','CREATE_ACTIVITY','CANCEL_ACTIVITY','PENDING_ACTIVITIES','VERIFY_ACTIVITY'].includes(action)){
   if(action==='PENDING_ACTIVITIES'&&!history&&Object.keys(input).length===0)return {items:[],serverNow:now()};
   if(!history||!activitySource)throw fail('COMM_HISTORY_CONFIG_REQUIRED',503);
   return obligations.execute(action,input,a);
  }
  if(action==='MESSAGE_READ'){
   if(Object.keys(input).length!==1)throw fail('COMM_INVALID_INPUT');const m=await store.get('communicationMessages',id(input.id));
   if(!m||!isCurrentMessage(m,now())||!await audience(m,ownProfile,a.sourceUid))throw fail('COMM_FORBIDDEN',403);
   return history&&m.history&&!m.historyLegacy?history.markRead(input,a.sourceUid):{recorded:false,legacy:true};
  }
  if(action==='HISTORY_RETRY'){
   if(!history||Object.keys(input).length!==1)throw fail('COMM_INVALID_INPUT');const m=await store.get('communicationMessages',id(input.id));if(!m?.history)throw fail('COMM_NOT_FOUND',404);return {syncQueued:await history.afterPublish(m)};
  }
  if(action==='SENT_DETAIL'){
   if(!communicationSenderRole(a.email)||!Object.keys(input).every(k=>['id','historyRow'].includes(k)))throw fail('COMM_FORBIDDEN',403);
   const key=id(input.id),m=await store.get('communicationMessages',key);
   if(m&&m.status!=='archived'){
    const result=history?await history.detail({id:key}):{message:m,recipients:[],recipientsRecorded:false,syncPending:false};
    const dispatch=await store.get('communicationDispatches',key);
    if(dispatch)result.message={...result.message,pushStatus:dispatch.status==='completed'?('Aceitos pelo provedor: '+(dispatch.accepted||0)+' · Falhas: '+(dispatch.failed||0)):'Processamento: '+dispatch.status};
    return result;
   }
   if(!historyDrive)throw fail('COMM_NOT_FOUND',404);
   const archived=await historyDrive.readMessage({row:m?.history?.messageRow||input.historyRow});
   if(!archived||archived.id!==key)throw fail('COMM_NOT_FOUND',404);
   return {message:archived,recipients:archived.recipientsRecorded?await historyDrive.readRecipients({start:archived.recipientStart,count:archived.recipientCount}):[],recipientsRecorded:archived.recipientsRecorded,syncPending:false,serverNow:now()};
  }
  if(['BOOTSTRAP','INBOX','REGISTER_DEVICE'].includes(action))await presence(input.installation,a);
  if(action==='USAGE')return usage();
  if(action==='BOOTSTRAP')return {isAdmin:adminIdentity(a),projectId:FF.projectId,databaseId:FF.databaseId,batchSize:BATCH_SIZE};
  if(action==='PUSH_TEAM_STATUS')return pushTeamStatus(input);
  if(action==='REGISTER_DEVICE'||action==='DISABLE_DEVICE')return device(input,a,action==='REGISTER_DEVICE');
  if(action==='INBOX'){
   const recent=input.recent===true;
   const rows=await store.page('communicationMessages',{cursor:input.cursor||'',limit:5,...(recent?{publishedBefore:now()}:{filters:[['status','published']]})}),items=[];
   if(!input.cursor&&!(recent&&input.chronological===true)){const pointer=await store.get('communicationReleaseInboxes',a.sourceUid);if(pointer?.messageId){const release=await store.get('communicationMessages',id(pointer.messageId));if(release?.audienceType==='USER'&&release.audienceValue===a.sourceUid&&isCurrentMessage(release,now()))items.push(release);}}
   for(const m of rows)if(!items.some(item=>item.id===m.id)&&isCurrentMessage(m,now())&&await audience(m,ownProfile,a.sourceUid))items.push(m);
   const last=rows.at(-1);
   let pushEnrollment;
   if(input.pushEnrollment===true&&!input.cursor){
    const deviceId=typeof input.pushEnrollmentDeviceId==='string'&&/^[a-f0-9-]{36}$/.test(input.pushEnrollmentDeviceId)?input.pushEnrollmentDeviceId:'';
    pushEnrollment=isEffective(ownProfile)&&!await hasActivePush(a.sourceUid,deviceId);
   }
   return {items,cursor:rows.length===5?(recent?`${last.publishAt}|${last.id}`:last.id):null,...(pushEnrollment===undefined?{}:{pushEnrollment})};
  }
  if(action==='SENT_MESSAGES'){
   if(historyDrive&&typeof input.cursor==='string'&&input.cursor.startsWith('archive:')){
    const before=Number(input.cursor.slice(8)),result=await historyDrive.readMessages({before,limit:input.filters?.recipient?5:20,filters:input.filters||{}});
    const active=await store.getMany('communicationMessages',result.items.map(m=>m.id));let items=result.items.filter((m,n)=>!active[n]||active[n].status==='archived'||active[n].status==='cancelled');
    if(input.filters?.recipient){const match=String(input.filters.recipient).toLocaleLowerCase('pt-BR'),keep=[];for(const m of items){const people=m.recipientsRecorded?await historyDrive.readRecipients({start:m.recipientStart,count:m.recipientCount}):[];if(people.some(p=>p.uid===match||[p.displayName,p.email].some(v=>v.toLocaleLowerCase('pt-BR').includes(match))))keep.push(m);}items=keep;}
    return {items:items.map(m=>({...m,sender:communicationSenderRole(m.senderEmail)||m.senderEmail})),cursor:result.cursor?`archive:${result.cursor}`:null};
   }
   const rows=await store.page('communicationMessages',{cursor:input.cursor||'',limit:PAGE_SIZE,publishedBefore:now()});
   const items=rows.flatMap(m=>{
    const sender=communicationSenderRole(m.createdBy?.email);
    return sender?[{id:m.id,title:m.title,message:m.message,category:m.category,publishAt:m.publishAt,audienceType:m.audienceType,audienceValue:history?m.audienceValue:m.audienceType==='GROUP'?m.audienceValue:'',sender,...(history?{senderEmail:m.createdBy?.email||'',activity:m.activity||null,recipientsRecorded:Boolean(m.history&&!m.historyLegacy),historyRow:m.history?.messageRow}: {})}]:[];
   });
   const last=rows.at(-1);
   let cursor=rows.length===PAGE_SIZE?`${last.publishAt}|${last.id}`:null;
   if(!cursor&&historyDrive){const state=await store.get('communicationHistoryState','2026');if(state?.nextMessageRow>2)cursor=`archive:${state.nextMessageRow}`;}
   const f=input.filters||{};return {items:items.filter(m=>(!f.from||m.publishAt>=Number(f.from))&&(!f.to||m.publishAt<=Number(f.to))&&(!f.kind||f.kind===(m.activity?.kind||'MESSAGE'))&&(!f.audience||f.audience===m.audienceValue||f.audience===m.audienceType)&&(!f.search||[m.title,m.message,m.senderEmail||m.sender].some(v=>String(v).toLocaleLowerCase('pt-BR').includes(String(f.search).toLocaleLowerCase('pt-BR'))))),cursor};
  }
  if(action==='MESSAGE'){
   const m=await store.get('communicationMessages',id(input.id));
   if(!m||!adminIdentity(a)&&(!isCurrentMessage(m,now())||!await audience(m,ownProfile,a.sourceUid)))throw fail('COMM_FORBIDDEN',403);
   return {message:m};
  }
  if(action==='SCHEDULE_RELEASE_NOTICE')return releaseNotice(input,a);
  if(action==='CREATE_EVENT')return createEvent(input,a);
  if(action==='SAVE_MESSAGE')return operationalNoticeIdentity(a)?urgentNotice(input,a):saveMessage(input,a);
  if(action==='IMPORT_SOURCE')throw fail('COMM_SOURCE_UNSUPPORTED');
  if(['MESSAGES','GROUPS','HISTORY','AUDIT'].includes(action)){
   const collection={MESSAGES:'communicationMessages',GROUPS:'communicationGroups',HISTORY:'communicationDispatches',AUDIT:'communicationAuditLogs'}[action];
   const result=paged(await store.page(collection,{cursor:input.cursor||'',limit:PAGE_SIZE+1,filters:action==='AUDIT'&&input.id?[['subject',id(input.id)]]:[]}));
   if(action==='GROUPS'&&!input.cursor)result.items.unshift(...BUILTIN_GROUPS.map(g=>({...g,builtin:true,active:true,memberUids:[]})));return result;
  }
  if(action==='DIRECTORY'){
   const users=await store.eligibleRecipients();
   return {items:users.filter(user=>!isSystemOwnerEmail(user.email)),cursor:null};
  }
  if(action==='PUSH_DEVICE_DIRECTORY')return pushDeviceDirectory(input);
  if(action==='AREAS')return paged(await store.page('managementAreas',{cursor:input.cursor||'',limit:PAGE_SIZE+1,filters:[['active',true]],fields:['name','title','active']}));
  if(action==='SAVE_GROUP'){
   const key=input.id?id(input.id):uuid(),name=text(input.name,100),members=[...new Set(input.memberUids||[])];
   if(key.startsWith('institutional-'))throw fail('COMM_FORBIDDEN',403);
   if(!Array.isArray(input.memberUids)||members.length>100||members.some(x=>typeof x!=='string'))throw fail('COMM_INVALID_INPUT');
   const profiles=await store.getMany('users',members.map(id));if(profiles.some(p=>!activeProfile(p)))throw fail('COMM_INVALID_AUDIENCE');
   return store.transaction(async tx=>{const old=await tx.get('communicationGroups',key);if((old?.version||0)!==input.version)throw fail('COMM_CONFLICT',409);const g={id:key,name,memberUids:members,active:input.active!==false,version:(old?.version||0)+1,updatedAt:now(),updatedBy:actorData(a)};tx.set('communicationGroups',key,g);audit(tx,a,'GROUP_SAVED',key,{record:g});return {group:g};});
  }
  if(action==='SETTINGS')return {settings:await store.get('communicationSettings','main')||{pushEnabled:false},projectId:FF.projectId,databaseId:FF.databaseId,dailyRequestLimit:COMMUNICATION_LIMITS.dailyOperations,dailyPublicationLimit:COMMUNICATION_LIMITS.dailyPublications,batchSize:BATCH_SIZE,categories:CATEGORIES};
  if(action==='SAVE_SETTINGS'){
   if(typeof input.pushEnabled!=='boolean')throw fail('COMM_INVALID_INPUT');
   return store.transaction(async tx=>{tx.set('communicationSettings','main',{pushEnabled:input.pushEnabled,updatedAt:now(),updatedBy:actorData(a)});audit(tx,a,'SETTINGS_SAVED','main',{pushEnabled:input.pushEnabled});return {saved:true};});
  }
  if(action==='METRICS'){
   const month=input.month||new Date(now()).toISOString().slice(0,7);if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw fail('COMM_INVALID_INPUT');
   return {total:await store.get('communicationMetrics','total')||counters(),monthly:await store.get('communicationMetrics',month)||counters(),month};
  }
  if(action==='PREPARE')return prepare(input,a);
  if(action==='SEND_BATCH')return batch(input,a);
  if(action==='RECONCILE'){
   if(input.confirmed!==true)throw fail('COMM_CONFIRMATION_REQUIRED');
   return store.transaction(async tx=>{const d=await tx.get('communicationDispatches',id(input.id));if(d?.status!=='processing'||d.batchStartedAt>now()-120000)throw fail('COMM_DISPATCH_LOCKED',409);const total=await tx.get('communicationMetrics','total')||counters(),month=new Date(d.batchStartedAt).toISOString().slice(0,7),monthly=await tx.get('communicationMetrics',month)||counters();const n=d.pendingCount;for(const v of [total,monthly]){v.unknown+=n;if(d.batches===1)v.sent++;}const updated={...d,status:'ready',unknown:d.unknown+n,processed:d.processed+n,pendingCount:0};tx.set('communicationDispatches',d.id,updated);tx.set('communicationMetrics','total',total);tx.set('communicationMetrics',month,monthly);audit(tx,a,'DISPATCH_RECONCILED_WITHOUT_RETRY',d.id,{batchId:d.batchId,unknown:n});return {dispatch:updated};});
  }
  throw fail('COMM_INVALID_ACTION');
 }};
}
