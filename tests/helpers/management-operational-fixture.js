import {createHash} from 'node:crypto';
import {harness,jwt,publicPem,rawUser,SECRET,ACTOR,TIME,FA,FB,FC} from './gateway-vm.js';
import {stateHarness} from './broker-state.js';
import {createDisabledManagementGatewayConfig} from '../../scripts/lib/management-gateway-config-preparation.js';
import {MANAGEMENT_GATEWAY_DATA_OPERATIONS} from '../../scripts/lib/management-gateway-protocol.js';
import {buildManagementAuthRuntime} from '../../worker-management-auth/runtime.js';
import {createManagementAuthWorker} from '../../worker-management-auth/worker.js';
export {TIME,FA,FB,FC};
export const ENDPOINT='https://synthetic-broker.example/v1/management/session';
export const GATEWAY='https://script.google.com/macros/s/'+'A'.repeat(30)+'/exec';
const copy=value=>JSON.parse(JSON.stringify(value));
export function jsonResponse(url,data,status=200,headers={}){const r=new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});Object.defineProperty(r,'url',{value:url});return r;}
export const encodeFields=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='boolean'?{booleanValue:v}:typeof v==='string'?{stringValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(x=>({stringValue:x}))}}:{mapValue:{fields:encodeFields(v)}}]));
export function operationalFixture(options={}) {
 const config=copy(createDisabledManagementGatewayConfig({actorEmail:ACTOR}).config);config.enabled=true;config.noncePolicy.maxNonceRecords=1536;
 Object.keys(config.policy.enabledOperations).forEach(k=>config.policy.enabledOperations[k]=true);
 MANAGEMENT_GATEWAY_DATA_OPERATIONS.forEach(k=>config.policy.enabledOperations[k]=true);
 const h=harness({configuration:config}),state=stateHarness(),docs=new Map(),transactions=new Map(),responses=new Map();
 let serial=0,revision=0,faAuthLookupCount=0;const operations=[],google=[],logs=h.state.executionLogs;
 const profile={active:true,access:true,role:'profissional',permissions:{trainingsRead:true,managementIndicatorsRead:true},
  ...(options.firstLoginEnabled===true?{firstLoginCohort:'OPERATIONAL'}:{}),...options.profile};
 const profileName='projects/'+FA+'/databases/(default)/documents/users/member-a';
 const stamp=()=>new Date(TIME+revision++).toISOString();
 docs.set(profileName,{name:profileName,fields:encodeFields(profile),createTime:new Date(TIME-10000).toISOString(),updateTime:new Date(TIME-2000).toISOString()});
 h.state.responseOverride=(url,request,response)=>{
  google.push({host:new URL(url).host,method:request.method});
  if(url.endsWith('/accounts:lookup')){const project=url.split('/projects/')[1].split('/')[0];
   if(options.missingAccount===project)return response({users:[]});
   const u=rawUser();if(project===FA&&options.providerlessFa===true&&faAuthLookupCount++===0)u.providerUserInfo=[];
   if(project!==FA){delete u.providerUserInfo;delete u.disabled;u.emailVerified=false;}
   if(options.wrongUid===project)u.localId='wrong-uid';
   return response({users:[u]});}
  if(url.endsWith(':signJwt')){const target=url.includes('@'+FC)?'FC':url.includes('@'+FB)?'FB':'FA';
   if(options.failSigner===target)return response({error:{status:'PERMISSION_DENIED',message:'never-print-secret'}},{status:403});
   const payload=JSON.parse(JSON.parse(request.payload).payload);if(options.mutateSignedUid===target)payload.uid='wrong-uid';
   if(options.revokeOnSign===target){const doc=docs.get(profileName);doc.fields.active={booleanValue:false};doc.updateTime=stamp();}
   return response({keyId:'synthetic-key',signedJwt:jwt(payload)});}
  if(url.startsWith('https://firestore.googleapis.com/v1/')){
   const parsed=new URL(url),path=decodeURIComponent(parsed.pathname.slice(4)),body=request.payload?JSON.parse(request.payload):null;
   if(options.firestoreStatus)return response({error:{status:'PERMISSION_DENIED',message:'secret user email@example.invalid'}},{status:options.firestoreStatus});
   if(request.method==='get'){const doc=docs.get(path);return doc?response(copy(doc)):response({error:{status:'NOT_FOUND'}},{status:404});}
   if(path.endsWith(':beginTransaction')){const id=Buffer.from('transaction-'+(++serial)).toString('base64');transactions.set(id,new Map([...docs].map(([k,v])=>[k,copy(v)])));return response({transaction:id});}
   if(path.endsWith(':batchGet'))return response(body.documents.map(name=>{const doc=(transactions.get(body.transaction)||docs).get(name);return {...(doc?{found:copy(doc)}:{missing:name}),readTime:new Date(TIME).toISOString()};}));
   if(path.endsWith(':rollback')){transactions.delete(body.transaction);return response({});}
   if(path.endsWith(':commit')){
    for(const write of body.writes){const prior=docs.get(write.update.name);if(write.currentDocument.exists===false&&prior||write.currentDocument.updateTime&&prior?.updateTime!==write.currentDocument.updateTime)
     return response({error:{status:'ABORTED'}},{status:409});}
    const updateTime=stamp();for(const write of body.writes)docs.set(write.update.name,{...copy(write.update),createTime:updateTime,updateTime});
    transactions.delete(body.transaction);return response({writeResults:body.writes.map(()=>({updateTime})),commitTime:updateTime});}
  }
  throw Error('UNEXPECTED_SYNTHETIC_GOOGLE_CALL');
 };
 const fetchImpl=async(url,request={})=>{
  if(url===GATEWAY){const envelope=JSON.parse(request.body);operations.push(envelope.operation);
   if(options.beforeGateway)await options.beforeGateway(envelope,request,h);
   if(options.hangOperation===envelope.operation)return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(Error('synthetic abort')),{once:true}));
   const result=h.call(envelope);if(options.tamperResponse)result.signature='0'.repeat(64);
   const location='https://script.googleusercontent.com/macros/echo?user_content_key=synthetic-'+(++serial);
   responses.set(location,result);const r=new Response(null,{status:302,headers:{location}});Object.defineProperty(r,'url',{value:url});return r;}
  if(responses.has(url))return jsonResponse(url,responses.get(url));
  if(url==='https://www.googleapis.com/oauth2/v3/certs'&&options.googleCertJwks)return jsonResponse(url,options.googleCertJwks,200,{'cache-control':'public, max-age=3600'});
  if(url.startsWith('https://www.googleapis.com/'))return jsonResponse(url,{'synthetic-key':publicPem},200,{'cache-control':'public, max-age=3600'});
  throw Error('UNEXPECTED_SYNTHETIC_HTTP_CALL');
 };
 const env={MANAGEMENT_AUTH_ENABLED:'true',MANAGEMENT_AUTH_FB_ENABLED:'true',MANAGEMENT_AUTH_FC_ENABLED:'true',MANAGEMENT_FIRST_LOGIN_ENABLED:options.firstLoginEnabled===true?'true':'false',
  MANAGEMENT_GATEWAY_ENABLED:'true',MANAGEMENT_GATEWAY_SCRIPT_URL:GATEWAY,MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL:SECRET.toString('base64url'),
  MANAGEMENT_GATEWAY_POLICY_JSON:JSON.stringify(config.policy),MANAGEMENT_GATEWAY_NONCE_POLICY_JSON:JSON.stringify(config.noncePolicy),
  MANAGEMENT_GATEWAY_MANAGEMENT_POLICY_VERSION:config.managementPolicyVersion,MANAGEMENT_GOOGLE_CLIENT_ID:'synthetic-google-client-id.apps.googleusercontent.com',BROKER_STATE:state.binding,...options.env};
 const worker=createManagementAuthWorker({buildRuntime:e=>buildManagementAuthRuntime(e,{fetchImpl,now:()=>h.state.time})});
 const completions=[];
 const workerFetch=async(url,request)=>{const req=new Request(url,{...request,headers:{...request.headers,Origin:'https://anestesiahmtforms.github.io'}});
   const response=await worker.fetch(req,env,{waitUntil:p=>completions.push(p)});Object.defineProperty(response,'url',{value:url});return response;};
 const token=jwt({sub:'member-a',aud:FA,iss:'https://securetoken.google.com/'+FA,auth_time:TIME/1000-50,iat:TIME/1000-10,exp:TIME/1000+3590,email_verified:true,
   firebase:{sign_in_provider:'google.com',identities:{'google.com':['google-id-a']}}});
 return {h,state,env,worker,workerFetch,fetchImpl,token,docs,profileName,operations,google,logs,completions};
}
