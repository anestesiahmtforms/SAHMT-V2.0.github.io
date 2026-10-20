import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='https://anestesiahmtforms.github.io',now=Date.parse('2026-10-19T15:00:00Z'),day='2026-10-19';
const claims={aud:'sahmt-17a16',iss:'https://securetoken.google.com/sahmt-17a16',sub:'synthetic-user',email_verified:true,iat:now/1000-10,auth_time:now/1000-10,exp:now/1000+3500,firebase:{sign_in_provider:'google.com',identities:{'google.com':['synthetic-provider']}}};
const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+Buffer.alloc(256).toString('base64url');
const entry=`import {createOperationalChannelWorker} from './worker-operational-channel/worker.js';
export {OperationalChannelState,OperationalChannelAuthorization} from './worker-operational-channel/worker.js';
const fixtureFetch=async(url,options)=>{new Request('https://outbound-fixture.invalid/',options);return url.startsWith('https://identitytoolkit.googleapis.com/')?Response.json({users:[{localId:'synthetic-user',emailVerified:true,validSince:'0',providerUserInfo:[{providerId:'google.com',rawId:'synthetic-provider'}]}]}):url.endsWith('/users/synthetic-user')?Response.json({name:'projects/sahmt-17a16/databases/(default)/documents/users/synthetic-user',fields:{displayName:{stringValue:'Pessoa sintética'},sigla:{stringValue:'AA'},active:{booleanValue:true},access:{booleanValue:true},permissions:{mapValue:{fields:{checklistRead:{booleanValue:true},checklistWrite:{booleanValue:true}}}}}}):Promise.reject(Error('SYNTHETIC_UNEXPECTED_DEPENDENCY'));};
export default createOperationalChannelWorker({now:()=>${now},fetchImpl:fixtureFetch});`;
test('bundle de produção executa em workerd com SQLite, isolamento e zero leituras Firestore durante compartilhamento',async()=>{
 const bundle=await build({stdin:{contents:entry,resolveDir:resolve('.')},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'channel',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-06',
  durableObjects:{OPERATIONAL_CHANNEL_STATE:{className:'OperationalChannelState',useSQLite:true},OPERATIONAL_CHANNEL_AUTHORIZATION:{className:'OperationalChannelAuthorization',useSQLite:true}},
  bindings:{OPERATIONAL_CHANNEL_ENABLED:'true',FA_FIREBASE_WEB_API_KEY:'synthetic-public-key-1234567890'},
  outboundService:async()=>assert.fail('Nenhum tráfego externo permitido no teste')}));
 try{
  const send=async body=>{const response=await mf.dispatchFetch('https://channel.invalid/v1/operational-channel',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,...await response.json()};};
  assert.equal((await send({action:'authorize'})).code,'CHANNEL_AUTHORIZED');
  const request={action:'submit',collection:'checklists',day,requestId:'synthetic-record',data:{date:day,stationId:'station1',condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null}};
  assert.equal((await send(request)).code,'CHANNEL_SHARED');assert.equal((await send(request)).code,'CHANNEL_ALREADY_SHARED');
  assert.equal((await send({action:'list',collection:'checklists',day})).records.length,1);
  assert.equal((await send({action:'withdraw',collection:'checklists',day,requestId:request.requestId})).code,'CHANNEL_WITHDRAWN');
  assert.equal((await send({action:'list',collection:'checklists',day})).records.length,0);
 }finally{await mf.dispose();}
});

test('opções de fetch usadas pelo Worker funcionam no runtime sem serviços externos',async()=>{
 const script=`export default {async fetch(){try{const response=await fetch('https://outbound-fixture.invalid/',{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:'{"synthetic":true}',redirect:'manual',signal:AbortSignal.timeout(1000)});return Response.json({code:response.status===200?'SYNTHETIC_FETCH_OK':'SYNTHETIC_FETCH_FAILED'});}catch(error){return Response.json({code:'SYNTHETIC_FETCH_REJECTED',category:error.name},{status:500});}}};`;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'fetch-contract',modules:true,script,compatibilityDate:'2026-10-06',outboundService:async request=>{assert.equal(new URL(request.url).hostname,'outbound-fixture.invalid');return Response.json({synthetic:true});}}));
 try{const response=await mf.dispatchFetch('https://local-worker.invalid/');assert.deepEqual(await response.json(),{code:'SYNTHETIC_FETCH_OK'});}finally{await mf.dispose();}
});
