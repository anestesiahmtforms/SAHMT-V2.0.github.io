import {scheduleWindow} from './schedule-envelope.js';

const CATEGORIES=['OPERATIONS','MANAGEMENT','RECORDS','SURVEYS','NOTIFICATIONS','CONTINUING_EDUCATION'];
const SOURCES=['FA','FG','FI','FB','FC','FE','ADMIN'];
const SOURCE_CATEGORY={FG:'OPERATIONS',FI:'OPERATIONS',FB:'MANAGEMENT',FC:'RECORDS',FE:'SURVEYS'};
const SOURCE_UIDS=Object.keys(SOURCE_CATEGORY),LEASE_MS=600000;
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value)&&!['.','..'].includes(value);
const rounded=value=>Math.round(value*100)/100;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const totals=()=>Object.fromEntries(CATEGORIES.map(category=>[category,0]));
const reads=value=>Object.fromEntries(Object.entries(value||{}).filter(([key,count])=>['FA','FG','FI','FB','FC','FE'].includes(key)&&Number.isSafeInteger(count)&&count>=0));
const sumReads=values=>{const result={};for(const value of values)for(const [key,count]of Object.entries(reads(value)))result[key]=(result[key]||0)+count;return result;};
const manifest=count=>[...SOURCES,...Array.from({length:Math.ceil(count/40)},(_,index)=>'RENDER_'+index),'PUBLISH'];
const validConfig=value=>value?.schemaVersion===1&&value.projectId==='rotinas-8a617'&&value.enabled===true;
function validateMembers(members){
 if(!Array.isArray(members)||!members.length||members.length>500)fail('SAHMT_MEMBER_LIMIT');
 const seen=new Set(),mapped=Object.fromEntries(SOURCE_UIDS.map(source=>[source,new Set()]));
 for(const member of members){
  if(!safe(member.uid)||member.id!==member.uid||seen.has(member.uid)||typeof member.active!=='boolean'||typeof member.access!=='boolean'||!member.sourceUids)fail('SAHMT_MEMBER_DIRECTORY_INVALID');
  seen.add(member.uid);
  for(const source of SOURCE_UIDS){const uid=member.sourceUids[source];if(uid!==null&&(!safe(uid)||mapped[source].has(uid)))fail('SAHMT_MEMBER_DIRECTORY_INVALID');if(uid!==null)mapped[source].add(uid);}
 }
 return members;
}
function cleanRows(rows,source,cutoff){
 if(!Array.isArray(rows)||rows.length>30000)fail('SAHMT_BATCH_LIMIT');
 return rows.map(row=>{
  const limit=source==='ADMIN'?2000000:1000000;
  if(!row||typeof row.id!=='string'||!row.id||row.id.length>(source==='ADMIN'?128:512)||row.source!==source||!safe(row.uid)||!CATEGORIES.includes(row.category)||(source==='ADMIN'?!['NOTIFICATIONS','CONTINUING_EDUCATION'].includes(row.category):SOURCE_CATEGORY[source]!==row.category)||typeof row.points!=='number'||!Number.isFinite(row.points)||Math.abs(row.points)>limit||Math.abs(row.points*100-Math.round(row.points*100))>1e-6||!Number.isFinite(row.createdAt)||row.createdAt>=cutoff)fail('SAHMT_SOURCE_ROW_INVALID');
  return {id:row.id,uid:row.uid,source,category:row.category,points:row.points,createdAt:row.createdAt,label:String(row.label||'Pontuação confirmada').slice(0,120)};
 });
}

// Every invocation owns one durable stage. Only PUBLISH can move the public pointer.
export function createSahmtDailyProcessor({store,sources,now=Date.now,uuid=()=>crypto.randomUUID()}){
 const getMany=(collection,ids)=>store.getMany?store.getMany(collection,ids):Promise.all(ids.map(id=>store.get(collection,id)));
 async function execute(scheduledTime,stage){
  const window=scheduleWindow(scheduledTime);
  if(!window||!Number.isSafeInteger(scheduledTime))fail('SAHMT_SCHEDULE_INVALID');
  if(scheduledTime>now()+5000||now()-scheduledTime>3600000)fail('SAHMT_SCHEDULE_EXPIRED');
  if(!['PREPARE',...SOURCES,'PUBLISH'].includes(stage)&&!/^RENDER_(?:[0-9]|1[0-2])$/.test(stage))fail('SAHMT_STAGE_INVALID');
  const batchId=window.id,stageId=batchId+'_'+stage,owner=uuid();if(!safe(owner))fail('SAHMT_STAGE_OWNER_INVALID');
  const claim=await store.transaction(async tx=>{
   const run=await tx.get('sahmtPerformanceRuns',batchId),old=await tx.get('sahmtDailyStages',stageId);
   if(run?.status==='CONFIRMED')return {complete:true,stages:[]};
   if(old?.status==='CONFIRMED')return old.result||{status:'CONFIRMED'};
   if(old?.status==='RUNNING'&&old.leaseUntil>now())return {status:'BUSY'};
   if(stage!=='PREPARE'&&!run)fail('SAHMT_STAGE_INCOMPLETE');
   tx.set('sahmtPerformanceRuns',batchId,{...run,batchId,cutoff:scheduledTime,status:'RUNNING',startedAt:run?.startedAt||now()});
   tx.set('sahmtDailyStages',stageId,{batchId,stage,status:'RUNNING',owner,leaseUntil:now()+LEASE_MS,startedAt:now(),attempt:(old?.attempt||0)+1});return null;
  });
  if(claim)return claim;
  async function owned(tx){
   const run=await tx.get('sahmtPerformanceRuns',batchId),record=await tx.get('sahmtDailyStages',stageId);
   if(!run||run.status==='CONFIRMED'||record?.status!=='RUNNING'||record.owner!==owner||record.leaseUntil<=now())fail('SAHMT_STAGE_LEASE_LOST');
   return record;
  }
  let attemptedReads={};
  async function complete(metadata={},result={status:'CONFIRMED'}){
   if(bytes(metadata)>425000)fail('SAHMT_STAGE_DOCUMENT_LIMIT');
   await store.transaction(async tx=>{const current=await owned(tx);tx.set('sahmtDailyStages',stageId,{...current,...metadata,status:'CONFIRMED',finishedAt:now(),result});});return result;
  }
  async function writeBatches(writes){
   let batch=[],size=0;
   const flush=async()=>{if(!batch.length)return;await store.transaction(async tx=>{await owned(tx);for(const [collection,id,value]of batch)tx.set(collection,id,value);});batch=[];size=0;};
   for(const write of writes){const amount=bytes(write[2]);if(amount>425000)fail('SAHMT_STAGE_DOCUMENT_LIMIT');if(batch.length===100||size+amount>3000000)await flush();batch.push(write);size+=amount;}await flush();
  }
  async function saveRows(rows){
   const chunks=[];let chunk=[],size=11;
   const flush=()=>{if(chunk.length)chunks.push(['sahmtDailyRows',batchId+'_'+stage+'_'+owner+'_'+chunks.length,{rows:chunk}]);chunk=[];size=11;};
   for(const row of rows){const amount=bytes(row)+1;if(chunk.length===500||size+amount>425000)flush();chunk.push(row);size+=amount;}flush();
   await writeBatches(chunks);return chunks.map(([,id])=>id);
  }
  try{
   let context=await store.get('sahmtDailyContexts',batchId);
   if(stage==='PREPARE'){
    if(!context){const config=await store.get('sahmtPerformanceRuntime','current');if(!validConfig(config))fail('SAHMT_PERFORMANCE_PREPARING');const members=validateMembers(await store.list('sahmtPerformanceMembers',[],501));context={batchId,cutoff:scheduledTime,config,members};}
    if(bytes(context)>425000)fail('SAHMT_STAGE_DOCUMENT_LIMIT');const result={complete:false,stages:manifest(context.members.length)};
    await store.transaction(async tx=>{const current=await owned(tx),existing=await tx.get('sahmtDailyContexts',batchId);if(!existing)tx.create('sahmtDailyContexts',batchId,context);tx.set('sahmtDailyStages',stageId,{...current,status:'CONFIRMED',finishedAt:now(),result});});return result;
   }
   if(!context||!manifest(context.members.length).includes(stage))fail('SAHMT_STAGE_INCOMPLETE');
   if(stage==='FA'){
    const input=await sources.loadEligibility({cutoff:scheduledTime,members:context.members});
    attemptedReads=reads(input?.readsByProject);
    validateMembers(input?.members);
    const original=new Map(context.members.map(member=>[member.uid,member]));
    if(input.members.length!==original.size||input.members.some(member=>!original.has(member.uid)||JSON.stringify(member.sourceUids)!==JSON.stringify(original.get(member.uid).sourceUids)))fail('SAHMT_MEMBER_DIRECTORY_INVALID');
    const eligible=new Set(input.eligibleUids);
    if(!Array.isArray(input.eligibleUids)||eligible.size!==input.eligibleUids.length||input.members.some(member=>eligible.has(member.uid)!==(member.active&&member.access))||[...eligible].some(uid=>!original.has(uid)))fail('SAHMT_MEMBER_DIRECTORY_INCOMPLETE');
    return complete({members:input.members,eligibleUids:[...eligible],readsByProject:reads(input.readsByProject)});
   }
   const fa=await store.get('sahmtDailyStages',batchId+'_FA');if(fa?.status!=='CONFIRMED')fail('SAHMT_STAGE_INCOMPLETE');
   if(SOURCES.includes(stage)){
    let input;
    if(stage==='ADMIN'){
     const manual=store.listAll?await store.listAll('sahmtPerformanceManual',[],30000):await store.list('sahmtPerformanceManual',[],1000);
     if(manual.length>30000)fail('SAHMT_BATCH_LIMIT');
     input={complete:true,rows:manual.filter(row=>row.createdAt<scheduledTime).map(row=>({id:row.id,uid:row.uid,category:row.category,source:'ADMIN',points:row.points,createdAt:row.createdAt,label:row.kind==='CONTINUING_EDUCATION'?'Educação continuada':({ADVERSE_EVENT:'Evento adverso',MEETING:'Participação em reunião',INFRACTION:'Infração',PRAISE:'Elogio'})[row.kind]||'Lançamento administrativo'}))};
    }else input=await sources.loadSource({source:stage,cutoff:scheduledTime,members:fa.members,fiPolicy:context.config.fiPolicy});
    attemptedReads=reads(input?.readsByProject);if(input?.complete!==true)fail('SAHMT_SOURCE_INCOMPLETE');
    const rows=cleanRows(input.rows,stage,scheduledTime),chunks=await saveRows(rows);
    return complete({rowCount:rows.length,chunks,readsByProject:reads(input.readsByProject),periodsBySource:input.periodsBySource||{}});
   }
   const checkpoints=await getMany('sahmtDailyStages',SOURCES.map(source=>batchId+'_'+source));
   if(checkpoints.some(record=>record?.status!=='CONFIRMED'))fail('SAHMT_STAGE_INCOMPLETE');
   const rowCount=checkpoints.reduce((count,record)=>count+(record.rowCount||0),0);if(rowCount>30000)fail('SAHMT_BATCH_LIMIT');
   if(stage.startsWith('RENDER_')){
    const chunkIds=checkpoints.flatMap(record=>record.chunks||[]),chunks=await getMany('sahmtDailyRows',chunkIds);
    if(chunks.some(chunk=>!Array.isArray(chunk?.rows)))fail('SAHMT_STAGE_INCOMPLETE');
    const all=chunks.flatMap(chunk=>chunk.rows);if(all.length!==rowCount)fail('SAHMT_STAGE_INCOMPLETE');
    const known=new Map(fa.members.map(member=>[member.uid,member])),eligible=new Set(fa.eligibleUids),seen=new Set(),records=new Map();
    const index=Number(stage.slice(7));for(const member of context.members.slice(index*40,(index+1)*40))if(eligible.has(member.uid))records.set(member.uid,{total:0,byCategory:totals(),rows:[]});
    for(const raw of all){
     const row=cleanRows([raw],raw.source,scheduledTime)[0],key=row.source+':'+row.id,member=known.get(row.uid);
     if(!member||seen.has(key))fail('SAHMT_SOURCE_ROW_INVALID');seen.add(key);
     if(!eligible.has(row.uid)){if(member.active&&member.access)fail('SAHMT_MEMBER_DIRECTORY_INCOMPLETE');continue;}
     const record=records.get(row.uid);if(!record)continue;
     record.total=rounded(record.total+row.points);record.byCategory[row.category]=rounded(record.byCategory[row.category]+row.points);
     record.rows.push({...row,id:key});
    }
    const writes=[];
    for(const [uid,record]of records){
     const historyPages=Object.fromEntries(CATEGORIES.map(category=>[category,Math.max(1,Math.ceil(record.rows.filter(row=>row.category===category).length/100))]));
     writes.push(['sahmtPerformanceSummaries',batchId+'_'+uid,{uid,batchId,total:record.total,byCategory:record.byCategory,historyPages}]);
     for(const category of CATEGORIES){
      const rows=record.rows.filter(row=>row.category===category).sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id)).map(({uid,category,...row})=>row);
      for(let page=0;page===0||page*100<rows.length;page++)writes.push(['sahmtPerformanceHistory',batchId+'_'+uid+'_'+category+'_'+page,{uid,batchId,category,rows:rows.slice(page*100,(page+1)*100),hasMore:(page+1)*100<rows.length}]);
     }
    }
    await writeBatches(writes);
    return complete({maxTotal:records.size?Math.max(...[...records.values()].map(record=>record.total)):null,eligibleCount:records.size});
   }
   const renders=await getMany('sahmtDailyStages',manifest(context.members.length).filter(name=>name.startsWith('RENDER_')).map(name=>batchId+'_'+name));
   if(renders.some(record=>record?.status!=='CONFIRMED'))fail('SAHMT_STAGE_INCOMPLETE');
   const eligibleCount=renders.reduce((count,record)=>count+record.eligibleCount,0),maxima=renders.filter(record=>record.eligibleCount).map(record=>record.maxTotal);
   if(eligibleCount!==fa.eligibleUids.length)fail('SAHMT_MEMBER_DIRECTORY_INCOMPLETE');
   const readsByProject=sumReads(checkpoints.map(record=>record.readsByProject)),periodsBySource=Object.assign({},...checkpoints.map(record=>record.periodsBySource||{}));
   await store.transaction(async tx=>{
    const current=await owned(tx),config=await tx.get('sahmtPerformanceRuntime','current'),previous=await tx.get('sahmtPerformanceReference','current');
    if(!validConfig(config)||JSON.stringify(config)!==JSON.stringify(context.config))fail('SAHMT_RUNTIME_CHANGED');
    if(previous?.cutoff>scheduledTime)fail('SAHMT_BATCH_SUPERSEDED');
    tx.set('sahmtPerformanceReference','current',{schemaVersion:1,batchId,cutoff:scheduledTime,publishedAt:now(),maxTotal:maxima.length?Math.max(...maxima):0,eligibleCount,periodsBySource});
    tx.set('sahmtPerformanceRuns',batchId,{batchId,cutoff:scheduledTime,status:'CONFIRMED',finishedAt:now(),rowCount,readsByProject});
    tx.set('sahmtDailyStages',stageId,{...current,status:'CONFIRMED',finishedAt:now(),result:{status:'CONFIRMED'}});
   });return {status:'CONFIRMED'};
  }catch(error){
   const code=/^SAHMT_[A-Z_]+$/.test(error.code||error.message)?error.code||error.message:'SAHMT_SOURCE_UNAVAILABLE';
   const readsByProject=sumReads([attemptedReads,error.readsByProject]);
   await store.transaction(async tx=>{const record=await tx.get('sahmtDailyStages',stageId),run=await tx.get('sahmtPerformanceRuns',batchId);if(record?.owner===owner&&record.status==='RUNNING'&&run?.status!=='CONFIRMED'){tx.set('sahmtDailyStages',stageId,{...record,status:'FAILED',code,readsByProject,failedAt:now()});tx.set('sahmtPerformanceRuns',batchId,{...run,status:'PARTIAL',code,failedStage:stage,readsByProject,failedAt:now()});}}).catch(()=>{});
   throw Object.assign(Error(code),{code,status:503});
  }
 }
 return Object.freeze({execute});
}
