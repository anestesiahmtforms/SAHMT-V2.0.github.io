import {createHash} from 'node:crypto';
import {FF,adminIdentity,activeProfile,id,text,fail,validateMessage,isCurrentMessage,matches,PAGE_SIZE,BATCH_SIZE,CATEGORIES,safePreview,automaticNoticePreview,BUILTIN_GROUPS,SOURCE_COLLECTIONS} from '../communication/domain.js';
import {assignedInstitutionalGroup} from '../src/institutional-group.js';
import {operationalNoticeIdentity,urgentNoticeInput,RELEASE_NOTICE,scheduleReleaseIdentity} from '../src/communication-operational-notices.js';
import {COMMUNICATION_LIMITS,communicationUsagePeriod} from '../src/communication-usage.js';
const digest=v=>createHash('sha256').update(v).digest('hex');
const counters=()=>({published:0,sent:0,devices:0,accepted:0,failed:0,unknown:0,categories:{}});
const actorData=a=>({uid:a.uid,sourceUid:a.sourceUid,email:a.email});
export function createCommunicationService({store,fa,fb,sources={},send,recipientEnabled,pushQueue,now=Date.now,uuid=()=>crypto.randomUUID()}){
 const audit=(tx,a,action,subject,detail={})=>tx.create('communicationAuditLogs',uuid(),{...actorData(a),at:now(),action,subject,detail});
 const admin=a=>{if(!adminIdentity(a))throw fail('COMM_FORBIDDEN',403);};
 const profile=async(uid,email)=>{const p=await fa.get('users',id(uid));if(!activeProfile(p)||p.uid!==uid||p.email?.toLowerCase()!==email)throw fail('COMM_FORBIDDEN',403);return p;};
 const readActions=new Set(['BOOTSTRAP','INBOX','MESSAGE','MESSAGES','GROUPS','HISTORY','DIRECTORY','PUSH_DEVICE_DIRECTORY','METRICS','SETTINGS','AREAS','AUDIT','IMPORT_SOURCE','USAGE']);
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
 async function audience(m,p,sourceUid){
  if(m.audienceType==='GROUP'){
   if(BUILTIN_GROUPS.some(g=>g.id===m.audienceValue)){
    const email=p.email.trim().toLowerCase(),people=await fb.page('users',{limit:2,filters:[['email',email]],fields:['uid','email','active','access']});
    if(people.length!==1||!activeProfile(people[0]))return false;
    const assignment=await fb.get('userCategories',digest(JSON.stringify(email)));
    return assignedInstitutionalGroup(assignment,{uid:people[0].uid,email})===m.audienceValue.slice('institutional-'.length);
   }
   const g=await store.get('communicationGroups',m.audienceValue);
   return matches(m,sourceUid,p,g?.active===true?g.memberUids:[]);
  }
  if(m.audienceType==='AREA'){
   const area=await fb.get('managementAreas',m.audienceValue);
   if(area?.active!==true)return false;
   // FB UIDs are resolved from the authoritative, unique email record. No UID equivalence.
   const users=await fb.page('users',{limit:2,filters:[['email',p.email]],fields:['uid','email','active','access']});
   return users.length===1&&activeProfile(users[0])&&[...(area.memberUids||[]),...(area.managerUids||[])].includes(users[0].uid);
  }
  return matches(m,sourceUid,p);
 }
 const paged=rows=>({items:rows.slice(0,PAGE_SIZE),cursor:rows.length>PAGE_SIZE?rows[PAGE_SIZE-1].id:null});
 async function saveMessage(input,a){
  const key=input.id?id(input.id):uuid(),m=validateMessage(input.message,now());
  if(m.audienceType==='USER'){const p=await fa.get('users',m.audienceValue);if(!activeProfile(p))throw fail('COMM_INVALID_AUDIENCE');}
  if((m.audienceType==='GROUP'&&!BUILTIN_GROUPS.some(g=>g.id===m.audienceValue))||m.audienceType==='AREA'){const g=await (m.audienceType==='GROUP'?store:fb).get(m.audienceType==='GROUP'?'communicationGroups':'managementAreas',m.audienceValue);if(g?.active!==true)throw fail('COMM_INVALID_AUDIENCE');}
  const source=input.source?await sourceReference(input.source):null;
  const saved=await store.transaction(async tx=>{
   const old=await tx.get('communicationMessages',key),dispatch=await tx.get('communicationDispatches',key);
   if(dispatch)throw fail('COMM_MESSAGE_LOCKED',409);
   if((old?.version||0)!==input.version)throw fail('COMM_CONFLICT',409);
   const firstPublish=m.status==='published'&&!old?.firstPublishedAt;
   const period=communicationUsagePeriod(now()),daily=firstPublish?await tx.get('communicationPublicationBudgets',period.day):null;
   const published=firstPublish?(Number.isSafeInteger(daily?.published)?daily.published:await tx.countPublished(period.startsAt,period.resetsAt)):null;
   if(firstPublish&&published>=COMMUNICATION_LIMITS.dailyPublications)throw quota('COMM_DAILY_PUBLICATION_LIMIT',published,COMMUNICATION_LIMITS.dailyPublications,period.resetsAt);
   const month=new Date(now()).toISOString().slice(0,7);
   const total=firstPublish?(await tx.get('communicationMetrics','total')||counters()):null;
   const monthly=firstPublish?(await tx.get('communicationMetrics',month)||counters()):null;
   const record={...m,id:key,version:(old?.version||0)+1,createdAt:old?.createdAt||now(),createdBy:old?.createdBy||actorData(a),updatedAt:now(),updatedBy:actorData(a),firstPublishedAt:old?.firstPublishedAt||(firstPublish?now():null),source:source?.reference||old?.source||null};
   tx.set('communicationMessages',key,record);
   const settings=await tx.get('communicationSettings','main');
   const automaticDispatch=m.status==='published'&&settings?.pushEnabled===true?{id:key,messageId:key,title:m.title,category:m.category,audienceType:m.audienceType,audienceValue:m.audienceValue,author:actorData(a),createdAt:now(),status:'queueing',cursor:'',version:record.version,processed:0,accepted:0,failed:0,skipped:0,unknown:0,batches:0,pendingCount:1,automatic:true}:null;
   if(automaticDispatch)tx.create('communicationDispatches',key,automaticDispatch);
   if(firstPublish)for(const [k,v]of [['total',total],[month,monthly]]){v.published++;v.categories[m.category]=(v.categories[m.category]||0)+1;tx.set('communicationMetrics',k,v);}
   if(firstPublish)tx.set('communicationPublicationBudgets',period.day,{published:published+1,at:now()});
   audit(tx,a,old?'MESSAGE_EDITED':'MESSAGE_CREATED',key,{version:record.version,status:m.status,record,automaticPush:Boolean(automaticDispatch)});return {message:record,dispatch:automaticDispatch,...(firstPublish?{publicationUsage:{used:published+1,limit:COMMUNICATION_LIMITS.dailyPublications,resetsAt:period.resetsAt}}:{})};
  });
  if(saved.dispatch){try{if(!pushQueue)throw fail('COMM_PUSH_QUEUE_UNAVAILABLE',503);await pushQueue.send({kind:'fanout',dispatchId:key,cursor:''});return {...saved,pushQueued:true};}catch{return {...saved,pushQueued:false};}}
  return {...saved,pushQueued:false};
 }
 async function urgentNotice(input,a){
  const fixed=urgentNoticeInput({noticeId:input.id||`urgent-${uuid()}`,title:input.message?.title,message:input.message?.message},now());
  try{return await saveMessage(fixed,a);}
  catch(error){
   if(!['COMM_CONFLICT','COMM_MESSAGE_LOCKED'].includes(error.code))throw error;
   const old=await store.get('communicationMessages',fixed.id);
   if(old?.status!=='published'||old.createdBy?.sourceUid!==a.sourceUid||old.title!==fixed.message.title||old.message!==fixed.message.message||old.audienceType!=='ALL'||old.category!=='AVISO URGENTE'||old.priority!=='URGENT')throw error;
   const dispatch=await store.get('communicationDispatches',fixed.id);
   return {message:old,dispatch,pushQueued:Boolean(dispatch),alreadySent:true};
  }
 }
 async function releaseNotice(input,a,ownProfile){
  if(!scheduleReleaseIdentity(ownProfile,a))throw fail('COMM_FORBIDDEN',403);
  const day=String(input.day||''),sigla=String(input.sigla||'').trim().toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||! /^(?:[A-Z]{2}|L2)$/.test(sigla))throw fail('COMM_INVALID_INPUT');
  const schedule=await fa.get('scheduleDays',day),releaseAt=Number(schedule?.highlights?.releaseTimes?.[sigla]);
  if(!schedule||!Array.isArray(schedule.highlights?.siglas)||!schedule.highlights.siglas.includes(sigla)||!Number.isSafeInteger(releaseAt)||releaseAt<=0||releaseAt>now()+60000)throw fail('COMM_NOT_CURRENT',409);
  const people=await fa.page('users',{limit:2,filters:[['sigla',sigla],['active',true],['access',true]],fields:['uid','email','displayName','sigla','active','access']});
  if(people.length!==1||typeof people[0].uid!=='string')throw fail('COMM_INVALID_AUDIENCE',409);
  const pushEligible=(await store.page('communicationDevices',{limit:1,filters:[['sourceUid',people[0].uid],['active',true]]})).length>0;
  const key=`release-${day}-${sigla}-${releaseAt}`;
  const old=await store.get('communicationMessages',key);
  if(old?.status==='published'){const dispatch=await store.get('communicationDispatches',key);return {message:old,dispatch,pushEligible,pushQueued:Boolean(dispatch),pushEnabled:(await store.get('communicationSettings','main'))?.pushEnabled===true,alreadySent:true};}
  const result=await saveMessage({id:key,version:0,message:{...RELEASE_NOTICE,category:'INFORMAÇÃO INSTITUCIONAL',priority:'HIGH',audienceType:'USER',audienceValue:people[0].uid,route:'home',publishAt:now(),expiresAt:now()+7*86400000,status:'published'}},a);
  return {...result,pushEligible,pushEnabled:(await store.get('communicationSettings','main'))?.pushEnabled===true};
 }
 async function device(input,a,enable){
  if(typeof input.token!=='string'||input.token.length<50||input.token.length>4096||/\s/.test(input.token))throw fail('COMM_INVALID_TOKEN');
  const key=digest(input.token);
  if(enable){const own=await store.page('communicationDevices',{limit:6,filters:[['uid',a.uid],['active',true]]});if(own.length>=5&&!own.some(d=>d.id===key))throw fail('COMM_DEVICE_LIMIT',409);}
  return store.transaction(async tx=>{
   const old=await tx.get('communicationDevices',key),metrics=await tx.get('communicationMetrics','total')||counters(),recipient=await tx.get('communicationRecipients',a.uid);
   const deviceIds=[];
   for(const previousId of (recipient?.deviceIds||[]).filter(k=>k!==key)){
    const previous=await tx.get('communicationDevices',previousId);
    if(previous?.active===true&&previous.uid===a.uid)deviceIds.push(previousId);
   }
   if(enable&&deviceIds.length>=5)throw fail('COMM_DEVICE_LIMIT',409);
   if(old&&old.uid!==a.uid)throw fail('COMM_DEVICE_OWNER',403);
   if(!enable&&!old)return {registered:false};
   const wasActive=old?.active===true;
   const deviceId=typeof input.deviceId==='string'&&/^[a-f0-9-]{36}$/.test(input.deviceId)?input.deviceId:old?.deviceId||'';
   const displayMode=['browser','standalone'].includes(input.displayMode)?input.displayMode:old?.displayMode||'';
   tx.set('communicationDevices',key,{id:key,uid:a.uid,sourceUid:a.sourceUid,email:a.email,googleUid:a.googleUid,token:input.token,active:enable,platform:String(input.platform||old?.platform||'').slice(0,60),deviceId,displayMode,updatedAt:now()});
   if(wasActive!==enable){metrics.devices=Math.max(0,metrics.devices+(enable?1:-1));tx.set('communicationMetrics','total',metrics);}
   tx.set('communicationRecipients',a.uid,{...actorData(a),googleUid:a.googleUid,verifiedAt:now(),deviceIds:enable?[...deviceIds,key]:deviceIds});
   audit(tx,a,enable?'DEVICE_REGISTERED':'DEVICE_DISABLED',key);return {registered:enable};
  });
 }
 async function pushDeviceDirectory(input){
  const rows=await fa.page('users',{cursor:input.cursor||'',limit:9,filters:[['active',true],['access',true]],fields:['uid','email','displayName','sigla','active','access']});
  const users=rows.slice(0,8),items=[];
  for(const user of users){
   const sourceUid=user.uid||user.id;
   const [installations,pushRows]=await Promise.all([
    fa.listUserAppInstallations(sourceUid,{limit:100}),
    store.page('communicationDevices',{limit:21,filters:[['sourceUid',sourceUid],['active',true]],fields:['active','deviceId','platform','displayMode','updatedAt']})
   ]);
   const appDevices=installations.filter(device=>device.target==='FA'&&typeof device.deviceId==='string');
   const installIds=new Set(appDevices.map(device=>device.deviceId));
   const activeUnlinked=pushRows.filter(device=>device.active===true&&(!device.deviceId||!installIds.has(device.deviceId)));
   const devices=appDevices.map(device=>{
    const linked=pushRows.filter(push=>push.deviceId===device.deviceId),active=linked.length>0;
    return {deviceId:device.deviceId,platform:String(device.platform||'Outro'),displayMode:String(device.displayMode||''),appVersion:String(device.appVersion||''),loadedRelease:Number(device.loadedRelease)||0,lastSeenAt:Number(device.lastSeenAt)||0,pushStatus:active?'ACTIVE':activeUnlinked.length?'UNLINKED':'NOT_REGISTERED',pushUpdatedAt:Math.max(0,...linked.map(push=>Number(push.updatedAt)||0))};
   });
   for(const push of activeUnlinked)devices.push({deviceId:'',platform:String(push.platform||'Outro'),displayMode:String(push.displayMode||''),appVersion:'',loadedRelease:0,lastSeenAt:0,pushStatus:'UNLINKED',pushUpdatedAt:Number(push.updatedAt)||0});
   if(devices.length)items.push({uid:sourceUid,displayName:String(user.displayName||''),email:String(user.email||''),sigla:String(user.sigla||''),devices});
  }
  return {items,cursor:rows.length>8?users.at(-1)?.id||null:null};
 }
 async function prepare(input,a){
  const key=id(input.id);
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
     const p=await fa.get('users',device.sourceUid);
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
 async function queueDevice(input){
  const dispatchId=id(input.dispatchId),deviceId=id(input.deviceId),dispatch=await store.get('communicationDispatches',dispatchId),receiptId=`${dispatchId}:${deviceId}`;
  if(!dispatch||dispatch.automatic!==true||dispatch.status==='completed')return {done:true};
  if(input.fanoutPageId){const page=await store.get('communicationPushFanoutPages',id(input.fanoutPageId));if(page?.reserved!==true||page.dispatchId!==dispatchId||!page.deviceIds?.includes(deviceId))throw fail('COMM_QUEUE_RETRY',503);}
  else if(dispatch.status==='queueing')throw fail('COMM_QUEUE_RETRY',503);
  if(!await claimQueueWork('communicationPushDeliveries',receiptId))return {done:true};
  try{
   const message=await store.get('communicationMessages',dispatchId),device=await store.get('communicationDevices',deviceId),settings=await store.get('communicationSettings','main');
   let outcome={status:'skipped',reason:'NOT_ELIGIBLE',disable:false};
   if(message&&device?.active===true&&settings?.pushEnabled===true&&isCurrentMessage(message,now())){
    const recipient=await fa.get('users',device.sourceUid);
    if(activeProfile(recipient)&&recipient.uid===device.sourceUid&&recipient.email?.toLowerCase()===device.email&&await audience(message,recipient,device.sourceUid)&&await recipientEnabled(device)){
     if(device.updatedAt<now()-30*86400000)outcome={status:'failed',reason:'STALE_DEVICE',disable:true};
     else outcome=await send(device.token,{communicationId:dispatchId,route:'home',...automaticNoticePreview(message)});
    }
   }
   await store.transaction(async tx=>{
    const live=await tx.get('communicationDispatches',dispatchId),receipt=await tx.get('communicationPushDeliveries',receiptId);if(!live||receipt?.status==='done')return;
    const status=['accepted','failed','skipped','unknown'].includes(outcome.status)?outcome.status:'unknown',pendingCount=Math.max(0,live.pendingCount-1),total=await tx.get('communicationMetrics','total')||counters(),month=new Date(now()).toISOString().slice(0,7),monthly=await tx.get('communicationMetrics',month)||counters();
    tx.set('communicationPushDeliveries',receiptId,{...receipt,status:'done',result:status,reason:outcome.reason||'',at:now()});
    tx.set('communicationDispatches',dispatchId,{...live,status:live.status==='queueing'?live.status:pendingCount?'processing':'completed',processed:live.processed+1,pendingCount,[status]:live[status]+1,updatedAt:now()});
    total[status]=(total[status]||0)+1;monthly[status]=(monthly[status]||0)+1;
    if(outcome.disable){const current=await tx.get('communicationDevices',deviceId);if(current?.active===true){tx.set('communicationDevices',deviceId,{...current,active:false,updatedAt:now()});total.devices=Math.max(0,total.devices-1);}}
    tx.set('communicationMetrics','total',total);tx.set('communicationMetrics',month,monthly);
   });
   return {done:true,status:outcome.status};
  }catch(error){await store.transaction(async tx=>{const receipt=await tx.get('communicationPushDeliveries',receiptId);if(receipt?.status==='processing')tx.set('communicationPushDeliveries',receiptId,{...receipt,status:'retry'});}).catch(()=>{});throw error;}
 }
 async function consumePush(input){if(!pushQueue)throw fail('COMM_PUSH_QUEUE_UNAVAILABLE',503);if(input?.kind==='fanout')return queueFanout(input);if(input?.kind==='device')return queueDevice(input);throw fail('COMM_INVALID_INPUT');}
 async function sourceReference(input){
  const {project,collection}=input,key=id(input.id);
  if(!SOURCE_COLLECTIONS[project]?.includes(collection))throw fail('COMM_SOURCE_UNSUPPORTED');
  const source=project==='FF'?store:project==='FA'?fa:project==='FB'?fb:sources[project];
  if(!source)throw fail('COMM_SOURCE_UNSUPPORTED');
  const fields=['notifications','communicationMessages','htmlTrainings'].includes(collection)?['title','message','description']:['updatedAt'];
  const record=await source.get(collection,key,undefined,fields);if(!record)throw fail('COMM_SOURCE_UNSUPPORTED');
  return {record,reference:{project,collection,id:key,verifiedAt:now()}};
 }
 return {consumePush,async execute(action,input,a){
  if(!input||Array.isArray(input)||typeof input!=='object')throw fail('COMM_INVALID_INPUT');
  const regular=new Set(['BOOTSTRAP','INBOX','MESSAGE','REGISTER_DEVICE','DISABLE_DEVICE','SCHEDULE_RELEASE_NOTICE']);
  if(!regular.has(action))admin(a);
  // Validate authorization before accessing directory, rate records or messages.
  const ownProfile=await profile(a.sourceUid,a.email);await admit(a,action);
  if(action==='USAGE')return usage();
  if(action==='BOOTSTRAP')return {isAdmin:adminIdentity(a),projectId:FF.projectId,databaseId:FF.databaseId,batchSize:BATCH_SIZE};
  if(action==='REGISTER_DEVICE'||action==='DISABLE_DEVICE')return device(input,a,action==='REGISTER_DEVICE');
  if(action==='INBOX'){
   const rows=await store.page('communicationMessages',{cursor:input.cursor||'',limit:5,filters:[['status','published']]}),items=[];
   if(!input.cursor&&/^(?:[A-Z]{2}|L2)$/.test(ownProfile.sigla||'')){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now())).map(part=>[part.type,part.value]));
    const day=`${parts.year}-${parts.month}-${parts.day}`,schedule=await fa.get('scheduleDays',day),releaseAt=Number(schedule?.highlights?.releaseTimes?.[ownProfile.sigla]);
    if(schedule?.highlights?.siglas?.includes(ownProfile.sigla)&&Number.isSafeInteger(releaseAt)&&releaseAt>0){
     const ownRelease=await store.get('communicationMessages',`release-${day}-${ownProfile.sigla}-${releaseAt}`);
     if(ownRelease?.audienceType==='USER'&&ownRelease.audienceValue===a.sourceUid&&isCurrentMessage(ownRelease,now()))items.push(ownRelease);
    }
   }
   for(const m of rows)if(!items.some(item=>item.id===m.id)&&isCurrentMessage(m,now())&&await audience(m,ownProfile,a.sourceUid))items.push(m);
   return {items,cursor:rows.length===5?rows.at(-1).id:null};
  }
  if(action==='MESSAGE'){
   const m=await store.get('communicationMessages',id(input.id));
   if(!m||!adminIdentity(a)&&(!isCurrentMessage(m,now())||!await audience(m,ownProfile,a.sourceUid)))throw fail('COMM_FORBIDDEN',403);
   return {message:m};
  }
  if(action==='SCHEDULE_RELEASE_NOTICE')return releaseNotice(input,a,ownProfile);
  if(action==='SAVE_MESSAGE')return operationalNoticeIdentity(a)?urgentNotice(input,a):saveMessage(input,a);
  if(action==='IMPORT_SOURCE'){
   const {record,reference}=await sourceReference(input);
   const copyText=['notifications','communicationMessages','htmlTrainings'].includes(input.collection);
   return {message:{title:copyText?String(record.title||'Comunicação institucional').slice(0,120):'Informação institucional — '+input.project,message:copyText?String(record.message||record.description||'Revise a informação institucional antes de publicar.').slice(0,4000):'Há uma atualização no módulo de origem. Revise e escreva aqui a comunicação institucional, sem dados pessoais ou de pacientes.',category:'INFORMAÇÃO INSTITUCIONAL',priority:'NORMAL',audienceType:'USER',audienceValue:'',route:{FA:'home',FB:'management',FC:'occurrences',FD:'management-hub',FE:'management-hub',FF:'communications'}[input.project],status:'draft',publishAt:now(),expiresAt:now()+7*86400000,source:reference}};
  }
  if(['MESSAGES','GROUPS','HISTORY','AUDIT'].includes(action)){
   const collection={MESSAGES:'communicationMessages',GROUPS:'communicationGroups',HISTORY:'communicationDispatches',AUDIT:'communicationAuditLogs'}[action];
   const result=paged(await store.page(collection,{cursor:input.cursor||'',limit:PAGE_SIZE+1,filters:action==='AUDIT'&&input.id?[['subject',id(input.id)]]:[]}));
   if(action==='GROUPS'&&!input.cursor)result.items.unshift(...BUILTIN_GROUPS.map(g=>({...g,builtin:true,active:true,memberUids:[]})));return result;
  }
  if(action==='DIRECTORY')return paged(await fa.page('users',{cursor:input.cursor||'',limit:PAGE_SIZE+1,filters:[['active',true],['access',true]],fields:['uid','email','displayName','role','active','access']}));
  if(action==='PUSH_DEVICE_DIRECTORY')return pushDeviceDirectory(input);
  if(action==='AREAS')return paged(await fb.page('managementAreas',{cursor:input.cursor||'',limit:PAGE_SIZE+1,filters:[['active',true]],fields:['name','title','active']}));
  if(action==='SAVE_GROUP'){
   const key=input.id?id(input.id):uuid(),name=text(input.name,100),members=[...new Set(input.memberUids||[])];
   if(key.startsWith('institutional-'))throw fail('COMM_FORBIDDEN',403);
   if(!Array.isArray(input.memberUids)||members.length>100||members.some(x=>typeof x!=='string'))throw fail('COMM_INVALID_INPUT');
   const profiles=await fa.getMany('users',members.map(id));if(profiles.some(p=>!activeProfile(p)))throw fail('COMM_INVALID_AUDIENCE');
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
