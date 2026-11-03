import {createHash} from 'node:crypto';
import {FF,adminIdentity,activeProfile,id,text,fail,validateMessage,isCurrentMessage,matches,PAGE_SIZE,BATCH_SIZE,CATEGORIES,safePreview,BUILTIN_GROUPS,SOURCE_COLLECTIONS} from '../communication/domain.js';
import {assignedInstitutionalGroup} from '../src/institutional-group.js';
const digest=v=>createHash('sha256').update(v).digest('hex');
const counters=()=>({published:0,sent:0,devices:0,accepted:0,failed:0,unknown:0,categories:{}});
const actorData=a=>({uid:a.uid,sourceUid:a.sourceUid,email:a.email});
export function createCommunicationService({store,fa,fb,sources={},send,recipientEnabled,now=Date.now,uuid=()=>crypto.randomUUID()}){
 const audit=(tx,a,action,subject,detail={})=>tx.create('communicationAuditLogs',uuid(),{...actorData(a),at:now(),action,subject,detail});
 const admin=a=>{if(!adminIdentity(a))throw fail('COMM_FORBIDDEN',403);};
 const profile=async(uid,email)=>{const p=await fa.get('users',id(uid));if(!activeProfile(p)||p.uid!==uid||p.email?.toLowerCase()!==email)throw fail('COMM_FORBIDDEN',403);return p;};
 async function admit(a){
  const day=new Date(now()).toISOString().slice(0,10),minute=Math.floor(now()/60000),key=digest(a.uid);
  await store.transaction(async tx=>{
   const d=await tx.get('communicationBudgets',day)||{requests:0},u=await tx.get('communicationRateLimits',key)||{};
   if(d.requests>=200)throw fail('COMM_FREE_QUOTA_EXHAUSTED',429);
   if(u.minute===minute&&u.count>=20)throw fail('COMM_RATE_LIMIT',429);
   tx.set('communicationBudgets',day,{requests:d.requests+1,at:now()});
   tx.set('communicationRateLimits',key,{minute,count:u.minute===minute?u.count+1:1});
  });
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
  return store.transaction(async tx=>{
   const old=await tx.get('communicationMessages',key),dispatch=await tx.get('communicationDispatches',key);
   if(dispatch)throw fail('COMM_MESSAGE_LOCKED',409);
   if((old?.version||0)!==input.version)throw fail('COMM_CONFLICT',409);
   const firstPublish=m.status==='published'&&!old?.firstPublishedAt;
   const month=new Date(now()).toISOString().slice(0,7);
   const total=firstPublish?(await tx.get('communicationMetrics','total')||counters()):null;
   const monthly=firstPublish?(await tx.get('communicationMetrics',month)||counters()):null;
   const record={...m,id:key,version:(old?.version||0)+1,createdAt:old?.createdAt||now(),createdBy:old?.createdBy||actorData(a),updatedAt:now(),updatedBy:actorData(a),firstPublishedAt:old?.firstPublishedAt||(firstPublish?now():null),source:source?.reference||old?.source||null};
   tx.set('communicationMessages',key,record);
   if(firstPublish)for(const [k,v]of [['total',total],[month,monthly]]){v.published++;v.categories[m.category]=(v.categories[m.category]||0)+1;tx.set('communicationMetrics',k,v);}
   audit(tx,a,old?'MESSAGE_EDITED':'MESSAGE_CREATED',key,{version:record.version,status:m.status,record});return {message:record};
  });
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
   tx.set('communicationDevices',key,{id:key,uid:a.uid,sourceUid:a.sourceUid,email:a.email,googleUid:a.googleUid,token:input.token,active:enable,platform:String(input.platform||'').slice(0,60),updatedAt:now()});
   if(wasActive!==enable){metrics.devices=Math.max(0,metrics.devices+(enable?1:-1));tx.set('communicationMetrics','total',metrics);}
   tx.set('communicationRecipients',a.uid,{...actorData(a),googleUid:a.googleUid,verifiedAt:now(),deviceIds:enable?[...deviceIds,key]:deviceIds});
   audit(tx,a,enable?'DEVICE_REGISTERED':'DEVICE_DISABLED',key);return {registered:enable};
  });
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
     else result={...result,...await send(device.token,{communicationId:key,route:m.route,...safePreview})};
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
 async function sourceReference(input){
  const {project,collection}=input,key=id(input.id);
  if(!SOURCE_COLLECTIONS[project]?.includes(collection))throw fail('COMM_SOURCE_UNSUPPORTED');
  const source=project==='FF'?store:project==='FA'?fa:project==='FB'?fb:sources[project];
  if(!source)throw fail('COMM_SOURCE_UNSUPPORTED');
  const record=await source.get(collection,key);if(!record)throw fail('COMM_SOURCE_UNSUPPORTED');
  return {record,reference:{project,collection,id:key,verifiedAt:now()}};
 }
 return {async execute(action,input,a){
  if(!input||Array.isArray(input)||typeof input!=='object')throw fail('COMM_INVALID_INPUT');
  const regular=new Set(['BOOTSTRAP','INBOX','MESSAGE','REGISTER_DEVICE','DISABLE_DEVICE']);
  if(!regular.has(action))admin(a);
  // Validate authorization before accessing directory, rate records or messages.
  const ownProfile=await profile(a.sourceUid,a.email);await admit(a);
  if(action==='BOOTSTRAP')return {isAdmin:adminIdentity(a),projectId:FF.projectId,databaseId:FF.databaseId,batchSize:BATCH_SIZE};
  if(action==='REGISTER_DEVICE'||action==='DISABLE_DEVICE')return device(input,a,action==='REGISTER_DEVICE');
  if(action==='INBOX'){
   const rows=await store.page('communicationMessages',{cursor:input.cursor||'',limit:5,filters:[['status','published']]}),items=[];
   for(const m of rows)if(isCurrentMessage(m,now())&&await audience(m,ownProfile,a.sourceUid))items.push(m);
   return {items,cursor:rows.length===5?rows.at(-1).id:null};
  }
  if(action==='MESSAGE'){
   const m=await store.get('communicationMessages',id(input.id));
   if(!m||!adminIdentity(a)&&(!isCurrentMessage(m,now())||!await audience(m,ownProfile,a.sourceUid)))throw fail('COMM_FORBIDDEN',403);
   return {message:m};
  }
  if(action==='SAVE_MESSAGE')return saveMessage(input,a);
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
  if(action==='AREAS')return paged(await fb.page('managementAreas',{cursor:input.cursor||'',limit:PAGE_SIZE+1,filters:[['active',true]],fields:['name','title','active']}));
  if(action==='SAVE_GROUP'){
   const key=input.id?id(input.id):uuid(),name=text(input.name,100),members=[...new Set(input.memberUids||[])];
   if(key.startsWith('institutional-'))throw fail('COMM_FORBIDDEN',403);
   if(!Array.isArray(input.memberUids)||members.length>100||members.some(x=>typeof x!=='string'))throw fail('COMM_INVALID_INPUT');
   const profiles=await fa.getMany('users',members.map(id));if(profiles.some(p=>!activeProfile(p)))throw fail('COMM_INVALID_AUDIENCE');
   return store.transaction(async tx=>{const old=await tx.get('communicationGroups',key);if((old?.version||0)!==input.version)throw fail('COMM_CONFLICT',409);const g={id:key,name,memberUids:members,active:input.active!==false,version:(old?.version||0)+1,updatedAt:now(),updatedBy:actorData(a)};tx.set('communicationGroups',key,g);audit(tx,a,'GROUP_SAVED',key,{record:g});return {group:g};});
  }
  if(action==='SETTINGS')return {settings:await store.get('communicationSettings','main')||{pushEnabled:false},projectId:FF.projectId,databaseId:FF.databaseId,dailyRequestLimit:200,batchSize:BATCH_SIZE,categories:CATEGORIES};
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
