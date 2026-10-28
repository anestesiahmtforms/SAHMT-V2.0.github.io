import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createDriveClient } from '../worker-training/drive.js';

const ROOT='1ETtQoCK4DBQ06gwecJbb0Ac5SneAnRGK', OWNER='anestesiahmtforms@gmail.com';
const credentials=()=>({clientId:'123-synthetic.apps.googleusercontent.com',clientSecret:'synthetic-secret',refreshToken:'synthetic-refresh-token',ownerEmail:OWNER});
const folder=(id,parents=[])=>({id,mimeType:'application/vnd.google-apps.folder',trashed:false,shared:false,parents,owners:[{emailAddress:OWNER}]});
function harness(){
  const calls=[],files=new Map([[ROOT,folder(ROOT)],['professional',folder('professional',[ROOT])],['category',folder('category',['professional'])]]);let time=1000,tokenCount=0;
  const h={calls,files,owner:OWNER,verified:true,override:null,set time(value){time=value;}};
  const response=(body,status=200)=>new Response(body===null?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
    if(h.override){const result=h.override(url,options);if(result)return result;}
    if(url==='https://oauth2.googleapis.com/token')return response({access_token:`synthetic-token-${++tokenCount}`,expires_in:3600,token_type:'Bearer'});
    if(url==='https://openidconnect.googleapis.com/v1/userinfo')return response({email:h.owner,email_verified:h.verified});
    if(url.startsWith('https://www.googleapis.com/drive/v3/files/generateIds?'))return response({ids:['reserved-file']});
    if(url.startsWith('https://www.googleapis.com/drive/v3/files/')){const id=new URL(url).pathname.split('/').at(-1);return files.has(id)?response(files.get(id)):response({error:{message:'DO NOT EXPOSE'}},404);}
    if(url.startsWith('https://www.googleapis.com/upload/drive/v3/files?'))return response({id:'reserved-file',parents:['category'],appProperties:{sahmtDigest:'a'.repeat(64)},mimeType:'application/pdf',size:'17',shared:false});
    throw Error('Unexpected mocked URL');
  };
  h.client=createDriveClient({credentials:credentials(),fetchImpl,now:()=>time});return h;
}
const upload=()=>({id:'reserved-file',folderId:'category',name:'synthetic.pdf',mimeType:'application/pdf',digest:'a'.repeat(64),bytes:Buffer.from('%PDF-1.7\n%%EOF\0\xff')});
const code=(expected,status)=>error=>error.code===expected&&(!status||error.status===status);
test('missing credentials disables Drive and invalid or service-account configuration fails closed',()=>{
  assert.deepEqual(createDriveClient(),{ready:false});assert.deepEqual(createDriveClient({credentials:null}),{ready:false});
  for(const value of [{}, {...credentials(),ownerEmail:'other@example.invalid'},{...credentials(),refreshToken:''},{...credentials(),clientSecret:'x\r\nInjected'},{type:'service_account',private_key:'synthetic'}])assert.throws(()=>createDriveClient({credentials:value}),code('DOCUMENT_DRIVE_CONFIG_INVALID',503));
  const h=harness();assert.equal(h.client.ready,true);assert.ok(!JSON.stringify(h.client).includes('synthetic-secret'));
});
test('refresh is form encoded, validates owner, deduplicates concurrent refresh and caches until expiry minus sixty seconds',async()=>{
  const h=harness();await Promise.all([h.client.allocateId(),h.client.allocateId()]);
  const refresh=h.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token');assert.equal(refresh.length,1);assert.equal(refresh[0].options.method,'POST');
  const body=new URLSearchParams(refresh[0].options.body);assert.equal(body.get('grant_type'),'refresh_token');assert.equal(body.get('refresh_token'),'synthetic-refresh-token');assert.equal(body.get('client_secret'),'synthetic-secret');
  assert.equal(h.calls.filter(c=>c.url.includes('/userinfo')).length,1);
  h.time=3540000;await h.client.allocateId();assert.equal(h.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,1);
  h.time=3541000;await h.client.allocateId();assert.equal(h.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,2);
  for(const c of h.calls.filter(c=>c.url.includes('/drive/v3/')))assert.match(c.options.headers.Authorization,/^Bearer synthetic-token-/);
});
test('wrong or unverified OAuth owner never reaches Drive and failed owner validation does not cache token',async()=>{
  for(const patch of [{owner:'other@example.invalid'},{verified:false}]){const h=harness();Object.assign(h,patch);await assert.rejects(h.client.allocateId(),code('DOCUMENT_DRIVE_OWNER_MISMATCH',403));assert.equal(h.calls.filter(c=>c.url.includes('/drive/v3/')).length,0);h.owner=OWNER;h.verified=true;await h.client.allocateId();assert.equal(h.calls.filter(c=>c.url==='https://oauth2.googleapis.com/token').length,2);}
});
test('destination requires fixed root, correct folder chain, nontrashed folders and owner',async()=>{
  const h=harness();await assert.rejects(h.client.verifyDestination('category','professional','other-root'),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));assert.equal(h.calls.length,0);
  await h.client.verifyDestination('category','professional',ROOT);
  for(const [id,patch] of [['category',{parents:['other']}],['professional',{parents:['other']}],['category',{trashed:true}],[ROOT,{owners:[{emailAddress:'other@example.invalid'}]}],['professional',{mimeType:'text/plain'}]]){
    const next=harness();next.files.set(id,{...next.files.get(id),...patch});await assert.rejects(next.client.verifyDestination('category','professional',ROOT),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));
    await assert.rejects(next.client.upload(upload()),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));assert.equal(next.calls.filter(c=>c.url.includes('/upload/')).length,0);
  }
});
test('upload uses reserved ID, private destination, digest metadata and byte-exact multipart; rechecks moved destination',async()=>{
  const h=harness();await assert.rejects(h.client.upload(upload()),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));
  await h.client.verifyDestination('category','professional',ROOT);const data=upload(),result=await h.client.upload(data);assert.equal(result.id,data.id);
  const request=h.calls.find(c=>c.url.includes('/upload/'));assert.equal(request.options.method,'POST');
  const url=new URL(request.url);assert.equal(url.searchParams.get('uploadType'),'multipart');assert.equal(url.searchParams.get('fields'),'id,parents,appProperties,mimeType,size,shared');
  assert.equal(result.shared,false);
  const boundary=request.options.headers['Content-Type'].split('boundary=')[1],body=Buffer.from(request.options.body);
  assert.ok(body.includes(data.bytes));assert.ok(body.subarray(-boundary.length-8).toString().includes(`--${boundary}--`));
  const text=body.toString('utf8'),metadata=JSON.parse(text.split('\r\n\r\n')[1].split('\r\n--')[0]);
  assert.deepEqual(metadata,{id:data.id,name:data.name,mimeType:data.mimeType,parents:[data.folderId],appProperties:{sahmtDigest:data.digest}});
  assert.equal(h.calls.filter(c=>c.url.includes('/permissions')).length,0);
  h.files.set('category',folder('category',['other']));await assert.rejects(h.client.upload(data),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));assert.equal(h.calls.filter(c=>c.url.includes('/upload/')).length,1);
});
test('file read distinguishes 404 and strips unrelated Google metadata',async()=>{
  const h=harness();assert.equal(await h.client.getFile('absent'),null);h.files.set('present',{id:'present',parents:['category'],appProperties:{sahmtDigest:'digest'},mimeType:'application/pdf',size:'10',shared:false,owners:[{emailAddress:'private@example.invalid'}],webContentLink:'private'});
  assert.deepEqual(await h.client.getFile('present'),{id:'present',parents:['category'],appProperties:{sahmtDigest:'digest'},mimeType:'application/pdf',size:'10',shared:false});
  assert.ok(new URL(h.calls.at(-1).url).searchParams.get('fields').split(',').includes('shared'));
});
test('redirects, malformed OAuth, Google failures and transport errors become short safe errors',async()=>{
  for(const status of [302,403,409,500]){const h=harness();h.override=()=>new Response('GOOGLE BODY WITH SENSITIVE DETAILS',{status});await assert.rejects(h.client.allocateId(),error=>error.code.startsWith('DOCUMENT_DRIVE_')&&!error.message.includes('SENSITIVE'));}
  const malformed=harness();malformed.override=url=>url.includes('/token')?new Response(JSON.stringify({access_token:'secret',expires_in:0}),{status:200}):null;await assert.rejects(malformed.client.allocateId(),code('DOCUMENT_DRIVE_AUTH_UNAVAILABLE',503));
  const network=harness();network.override=()=>{throw Error('sensitive network URL');};await assert.rejects(network.client.allocateId(),error=>error.message==='DOCUMENT_DRIVE_UNAVAILABLE');
});
test('Drive redirects and upload conflicts retain safe status and never follow redirect targets',async()=>{
  for(const [status,expected] of [[302,'DOCUMENT_DRIVE_UNAVAILABLE'],[403,'DOCUMENT_DRIVE_FORBIDDEN'],[409,'DOCUMENT_DRIVE_CONFLICT']]){
    const h=harness();await h.client.verifyDestination('category','professional',ROOT);h.override=url=>url.includes('/upload/')?new Response('secret error',{status,headers:{Location:'https://evil.invalid'}}):null;
    await assert.rejects(h.client.upload(upload()),code(expected,status===302?503:status));assert.ok(h.calls.every(c=>!c.url.includes('evil.invalid')));
  }
});
test('unexpected Google response shapes never escape as unsanitized runtime errors',async()=>{
  const auth=harness();auth.override=url=>url.includes('/token')?new Response(JSON.stringify({access_token:'synthetic',token_type:{bad:true},expires_in:3600}),{status:200}):null;
  await assert.rejects(auth.client.allocateId(),code('DOCUMENT_DRIVE_AUTH_UNAVAILABLE',503));
  for(const [id,patch] of [[ROOT,{owners:{bad:true}}],['category',{parents:{bad:true}}],[ROOT,{owners:[{emailAddress:{bad:true}}]}]]){
    const h=harness();h.files.set(id,{...h.files.get(id),...patch});await assert.rejects(h.client.verifyDestination('category','professional',ROOT),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));
  }
});
test('every folder must be explicitly private and solely owned by the fixed owner',async()=>{
  const patches=[{shared:true},{shared:undefined},{shared:'false'},{owners:[{emailAddress:'other@example.invalid'}]},{owners:[{emailAddress:OWNER},{emailAddress:'other@example.invalid'}]},{owners:[]}];
  for(const id of [ROOT,'professional','category'])for(const patch of patches){
    const h=harness();h.files.set(id,{...h.files.get(id),name:'Private professional documents',...patch});
    await assert.rejects(h.client.verifyDestination('category','professional',ROOT),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));
    await assert.rejects(h.client.upload(upload()),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));assert.equal(h.calls.filter(c=>c.url.includes('/upload/')).length,0);
  }
  const h=harness();await h.client.verifyDestination('category','professional',ROOT);
  for(const call of h.calls.filter(c=>c.url.includes('/drive/v3/files/')))assert.ok(new URL(call.url).searchParams.get('fields').split(',').includes('shared'));
  h.files.get('category').shared=true;await assert.rejects(h.client.upload(upload()),code('DOCUMENT_DRIVE_DESTINATION_INVALID',403));assert.equal(h.calls.filter(c=>c.url.includes('/upload/')).length,0);
});
test('recovered and newly uploaded files fail closed on shared or missing privacy evidence',async()=>{
  for(const shared of [true,undefined,'false']){
    const h=harness(),file={id:'reserved-file',parents:['category'],appProperties:{sahmtDigest:'a'.repeat(64)},mimeType:'application/pdf',size:'17',shared};h.files.set(file.id,file);
    await assert.rejects(h.client.getFile(file.id),error=>error.code==='DOCUMENT_DRIVE_FILE_NOT_PRIVATE'&&error.status===403&&error.message==='DOCUMENT_DRIVE_FILE_NOT_PRIVATE');
    await h.client.verifyDestination('category','professional',ROOT);h.override=url=>url.includes('/upload/')?Response.json(file):null;
    await assert.rejects(h.client.upload(upload()),code('DOCUMENT_DRIVE_FILE_NOT_PRIVATE',403));
  }
});
