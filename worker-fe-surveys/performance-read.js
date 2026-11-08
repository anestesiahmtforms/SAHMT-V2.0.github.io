import {createHmac,timingSafeEqual} from 'node:crypto';
export const FE_PERFORMANCE_READ_PATH='/internal/performance-read';
const root='https://firestore.googleapis.com/v1/projects/outros-48120/databases/(default)/documents';
const masks=Object.freeze({users:['uid','active','access','sigla'],fePerformanceAwards:['uid','category','points','survey','cycle','createdAt'],fePerformanceSummaries:['uid','total']});
const runtimeFields=['schemaVersion','projectId','enabled','effectiveFrom'];
const mac=(secret,time,body)=>createHmac('sha256',secret).update('POST\n'+FE_PERFORMANCE_READ_PATH+'\n'+time+'\n'+body).digest('hex');
const secretValid=secret=>typeof secret==='string'&&secret.length>=32;
const reject=status=>Response.json({code:'FE_PERFORMANCE_READ_DENIED'},{status,headers:{'Cache-Control':'no-store'}});
// Only fixed FE projections are supported. No arbitrary Firestore URL, field,
// collection, filter or document identifier crosses this authorization boundary.
export function createFePerformanceReadHandler({getAccessToken,fetchImpl=fetch,now=Date.now}={}){
 return async(request,env)=>{try{
  const secret=env.FE_PERFORMANCE_READ_SECRET;
  if(!secretValid(secret))return reject(503);
  if(request.method!=='POST'||new URL(request.url).search||request.headers.has('Origin'))return reject(403);
  const time=request.headers.get('X-FE-Read-Time'),signature=request.headers.get('X-FE-Read-Signature');
  if(!/^\d{13}$/.test(time||'')||Math.abs(now()-Number(time))>30000||!/^[a-f0-9]{64}$/.test(signature||''))return reject(401);
  if(Number(request.headers.get('Content-Length'))>8192)return reject(413);
  const reader=request.body?.getReader();if(!reader)return reject(400);let chunks=[],size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return reject(413);}chunks.push(value);}
  const text=Buffer.concat(chunks).toString('utf8');
  if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(mac(secret,time,text),'hex')))return reject(401);
  let input;try{input=JSON.parse(text);}catch{return reject(400);}
  if(!input||Object.keys(input).some(k=>!['path','body','cutoff'].includes(k))||typeof input.cutoff!=='string'||!Number.isFinite(Date.parse(input.cutoff))||new Date(input.cutoff).toISOString()!==input.cutoff||Date.parse(input.cutoff)>now())return reject(400);
  let url,body,allowed;
  if(input.path==='/fePerformanceRuntime/current'&&!input.body){
   allowed=runtimeFields;url=root+input.path+'?readTime='+encodeURIComponent(input.cutoff)+allowed.map(v=>'&mask.fieldPaths='+v).join('');
  }else if(input.path===':runQuery'){
   const q=input.body?.structuredQuery,collection=q?.from?.[0]?.collectionId;
   if(!Object.hasOwn(masks,collection)||!Number.isSafeInteger(q.limit)||q.limit<1||q.limit>1000||q.from.length!==1||Object.keys(q).some(k=>!['from','select','orderBy','startAt','limit'].includes(k))||input.body.readTime!==input.cutoff||Object.keys(input.body).some(k=>!['structuredQuery','readTime'].includes(k)))return reject(400);
   const cursor=q.startAt?.values?.[0]?.referenceValue;
   if(q.startAt&&(q.startAt.before!==false||q.startAt.values.length!==1||typeof cursor!=='string'||!cursor.startsWith(root.slice('https://firestore.googleapis.com/v1/'.length)+'/'+collection+'/')||!/^[A-Za-z0-9_.@+:%-]{1,512}$/.test(cursor.slice((root.slice('https://firestore.googleapis.com/v1/'.length)+'/'+collection+'/').length))))return reject(400);
   allowed=masks[collection];url=root+':runQuery';body={readTime:input.cutoff,structuredQuery:{from:[{collectionId:collection}],select:{fields:allowed.map(fieldPath=>({fieldPath}))},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:q.limit,...(cursor?{startAt:{values:[{referenceValue:cursor}],before:false}}:{})}};
  }else return reject(400);
  try{
   const response=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getAccessToken(env),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(25000)});
   if(!response.ok){await response.body?.cancel();return reject([400,401,403,404,412].includes(response.status)?response.status:503);}
   const value=await response.json();
   const clean=doc=>{if(!doc||typeof doc!=='object')throw Error();return {name:doc.name,fields:Object.fromEntries(Object.entries(doc.fields||{}).filter(([key])=>allowed.includes(key)))};};
   const result=body?(Array.isArray(value)?value.map(row=>({...(row.document?{document:clean(row.document)}:{}),...(row.error?{error:{code:row.error.code}}:{}),readTime:row.readTime})):null):clean(value);
   if(!result)return reject(503);
   return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch{return reject(503);}
 }catch{return reject(400);}};
}
export function createFePerformanceReader({endpoint,secret,fetchImpl=fetch,now=Date.now}={}){
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.pathname!==FE_PERFORMANCE_READ_PATH||url.search||url.hash||url.username||url.password||!secretValid(secret))throw Error('FE_PERFORMANCE_READ_CONFIG_REQUIRED');
 return async input=>{const body=JSON.stringify(input),time=String(now());return fetchImpl(url.href,{method:'POST',headers:{'Content-Type':'application/json','X-FE-Read-Time':time,'X-FE-Read-Signature':mac(secret,time,body)},body,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(25000)});};
}
