const FE_PROJECT='outros-48120';
const FK_START=Date.parse('2026-12-01T03:00:00.000Z');
const FE_ROOT=`https://firestore.googleapis.com/v1/projects/${FE_PROJECT}/databases/(default)/documents`;
const hex=bytes=>Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
function decode(value){
 if(value.stringValue!==undefined)return value.stringValue;
 if(value.integerValue!==undefined)return Number(value.integerValue);
 if(value.doubleValue!==undefined)return value.doubleValue;
 if(value.booleanValue!==undefined)return value.booleanValue;
 if(value.timestampValue!==undefined)return Date.parse(value.timestampValue);
 return null;
}
function fields(document){return Object.fromEntries(Object.entries(document.fields||{}).map(([key,value])=>[key,decode(value)]));}
async function signedPost(url,secret,payload){
 const body=JSON.stringify(payload),timestamp=String(Date.now()),nonce=crypto.randomUUID();
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}\n${nonce}\n${body}`)));
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({timestamp,nonce,payload:body,signature}),redirect:'follow',signal:AbortSignal.timeout(30000)});
 let result;try{result=await response.json();}catch{throw Error('FE_FK_PUSH_RESPONSE_INVALID');}
 if(!response.ok||!result?.code)throw Error('FE_FK_PUSH_REJECTED');
 return result;
}
async function sourceRows({cutoff,effectiveFrom,token,fetchImpl=fetch}){
 const rows=[];let cursor=null;
 for(;;){
  const structuredQuery={from:[{collectionId:'feFunctionalPerformanceEvents'}],
   where:{compositeFilter:{op:'AND',filters:[
    {fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:new Date(effectiveFrom).toISOString()}}},
    {fieldFilter:{field:{fieldPath:'createdAt'},op:'LESS_THAN',value:{timestampValue:new Date(cutoff).toISOString()}}}
   ]}},
   orderBy:[{field:{fieldPath:'createdAt'},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}],
   select:{fields:['uid','category','points','survey','cycle','affiliation','createdAt'].map(fieldPath=>({fieldPath}))},limit:1000,
   ...(cursor?{startAt:{values:[{timestampValue:cursor.createdAt},{referenceValue:cursor.name}],before:false}}:{})};
  const response=await fetchImpl(FE_ROOT+':runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({structuredQuery,readTime:new Date(cutoff).toISOString()}),redirect:'manual',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('FE_FK_SOURCE_READ_FAILED');
  const result=await response.json();if(!Array.isArray(result)||result.some(item=>item.error||item.readTime&&Date.parse(item.readTime)!==cutoff))throw Error('FE_FK_SOURCE_QUERY_INCOMPLETE');
  const documents=result.filter(item=>item.document).map(item=>item.document);
  for(const document of documents){
   const row=fields(document),id=document.name.split('/').at(-1);
   if(!/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(row.uid||'')||row.category!=='PERFORMANCE'||row.points!==1||row.affiliation!=='team'||
      !['climate','stress','epidemiological'].includes(row.survey)||typeof row.cycle!=='string'||id!==row.uid+'_'+row.survey+'_'+row.cycle||
      !Number.isSafeInteger(row.createdAt)||row.createdAt<effectiveFrom||row.createdAt>=cutoff)throw Error('FE_FK_SOURCE_ROW_INVALID');
   rows.push({id,uid:row.uid,category:'SURVEYS',points:row.points,createdAt:row.createdAt,label:'Participação em pesquisa institucional'});
   if(rows.length>30000)throw Error('FE_FK_SOURCE_BATCH_LIMIT');
  }
  if(documents.length<1000)break;
  const last=documents.at(-1),rawCreatedAt=last.fields?.createdAt?.timestampValue;
  if(typeof rawCreatedAt!=='string'||typeof last.name!=='string')throw Error('FE_FK_SOURCE_CURSOR_INVALID');
  cursor={createdAt:rawCreatedAt,name:last.name};
 }
 return rows;
}
export async function publishFePerformanceToFk({env,controller,fetchImpl=fetch,tokenFactory}={}){
 if(!env?.FK_APPS_SCRIPT_URL||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.FK_APPS_SCRIPT_URL)||
    typeof env.FK_SOURCE_HMAC_SECRET_FE!=='string'||env.FK_SOURCE_HMAC_SECRET_FE.length<32)throw Error('FE_FK_PUSH_CONFIG_REQUIRED');
 // Firestore only accepts recent readTime values; use execution time in case
 // Cloudflare starts a scheduled event late.
 const cutoff=Math.floor(Date.now()/1000)*1000;
 if(cutoff<=FK_START) return {code:'FE_FK_PUSH_NOT_STARTED'};
 const credentials=JSON.parse(env.FE_SERVICE_ACCOUNT_JSON||'{}');
 const token=await tokenFactory(credentials);
 const rows=await sourceRows({cutoff,effectiveFrom:FK_START,token,fetchImpl});
 const chunks=[];let chunk=[],size=0;
 for(const row of rows){const amount=new TextEncoder().encode(JSON.stringify(row)).length+1;
  if(chunk.length>=400||size+amount>300000){chunks.push(chunk);chunk=[];size=0;}
  chunk.push(row);size+=amount;
 }
 if(chunk.length||!chunks.length)chunks.push(chunk);
 if(chunks.length>100)throw Error('FE_FK_PUSH_BATCH_LIMIT');
 for(let chunkIndex=0;chunkIndex<chunks.length;chunkIndex++){
  const result=await signedPost(env.FK_APPS_SCRIPT_URL,env.FK_SOURCE_HMAC_SECRET_FE,{action:'PERFORMANCE_SOURCE_PUSH',source:'FE',cutoff,
   effectiveFrom:FK_START,chunkIndex,chunkCount:chunks.length,rows:chunks[chunkIndex]});
  if(result.code!=='FK_SOURCE_BATCH_SAVED')throw Error('FE_FK_PUSH_CHUNK_FAILED');
 }
 const published=await signedPost(env.FK_APPS_SCRIPT_URL,env.FK_SOURCE_HMAC_SECRET_FE,{action:'PERFORMANCE_SOURCE_PUBLISH',source:'FE',cutoff,
  effectiveFrom:FK_START,chunkCount:chunks.length,rowCount:rows.length});
 if(published.code!=='FK_SOURCE_BATCH_PUBLISHED')throw Error('FE_FK_PUSH_PUBLISH_FAILED');
 return {code:'FE_FK_PERFORMANCE_PUSHED',cutoff,rowCount:rows.length,chunks:chunks.length};
}
