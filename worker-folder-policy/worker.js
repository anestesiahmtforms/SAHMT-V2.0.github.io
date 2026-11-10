import {FA_PROJECT, DOMAIN_PROJECTS, boundedJson, verifyFaSession} from '../worker-operational-domain/identity.js';
import {createServiceTokenProvider} from '../worker-fa-performance/service-token.js';
import {encodeFields, decodeFields} from '../worker-training/firestore.js';
import {publishFolderAvailability,inspectFolderPublication} from './publication.js';

const origin='https://anestesiahmtforms.github.io';
const projects=Object.freeze({FA:FA_PROJECT,...DOMAIN_PROJECTS,FF:'sahmt-comunicacao-ff',FC:'indicadores---sahmt',FD:'rotinas-8a617',FE:'outros-48120',FB:'sahmt-gestao-5ae66'});
const fail=(code,status=503)=>Object.assign(Error(code),{code,status});
const policyPath='runtimePolicy/folders';

export function createFolderPolicyStore({getAccessToken,fetchImpl=fetch}) {
 async function request(target,path,options={}) {
  const {method='GET',body,precondition}=options;
  const project=projects[target];
  if(!project)throw fail('FOLDER_POLICY_CONFIG');
  const name=`projects/${project}/databases/${target==='FF'?'comunicacao':'(default)'}/documents/${path}`;
  const url=new URL('https://firestore.googleapis.com/v1/'+name);
  if(method==='PATCH'){
   if(precondition===null)url.searchParams.set('currentDocument.exists','false');
   else url.searchParams.set('currentDocument.updateTime',precondition);
  }
  const response=await fetchImpl(url,{method,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),
   headers:{Authorization:'Bearer '+await getAccessToken(),...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify({fields:encodeFields(body)})}:{})});
  if(method==='GET'&&response.status===404){await response.body?.cancel();return null;}
  const result=await boundedJson(response,131072);
  if(method==='PATCH'&&([409,412].includes(response.status)||['FAILED_PRECONDITION','ALREADY_EXISTS','ABORTED'].includes(result.error?.status)))
   throw fail('FOLDER_POLICY_CONFLICT',409);
  if(!response.ok||result.name!==name||typeof result.updateTime!=='string')throw fail('FOLDER_POLICY_STORAGE');
  return {value:decodeFields(result.fields||{}),version:result.updateTime};
 }
 return {
  read:target=>request(target,policyPath),
  write:(target,value,precondition)=>request(target,policyPath,{method:'PATCH',body:value,precondition}),
  async profile(uid){return (await request('FA','users/'+encodeURIComponent(uid)))?.value??null;}
 };
}

export function createFolderPolicyWorker({verify=verifyFaSession,storeFor}={}) {
 const instances=new WeakMap();
 function resolveStore(env) {
  if(storeFor)return storeFor(env);
  if(!instances.has(env)){
   const credentials=JSON.parse(env.FOLDER_POLICY_SERVICE_ACCOUNT_JSON||'null');
   instances.set(env,createFolderPolicyStore({getAccessToken:createServiceTokenProvider({credentials})}));
  }
  return instances.get(env);
 }
 return {
  async fetch(request,env) {
   const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin'};
   const reply=(body,status)=>Response.json(body,{status,headers});
   if(request.headers.get('Origin')!==origin)return reply({code:'FOLDER_POLICY_FORBIDDEN'},403);
   Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type'});
   if(new URL(request.url).pathname!=='/v1/operational-folders')return reply({code:'FOLDER_POLICY_NOT_FOUND'},404);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   if(request.method!=='POST')return reply({code:'FOLDER_POLICY_METHOD'},405);
   if(env.FOLDER_POLICY_ENABLED!=='true')return reply({code:'FOLDER_POLICY_UNAVAILABLE'},503);
   try{
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fail('FOLDER_POLICY_INPUT',400);
    const data=await boundedJson(request,2048);
    const actor=await verify(request.headers.get('Authorization'),{apiKey:env.FA_PUBLIC_API_KEY});
    if(!actor.emailVerified)throw fail('FOLDER_POLICY_FORBIDDEN',403);
    if(data?.inspect===true&&Object.keys(data).length===1){
     return reply(await inspectFolderPublication({store:resolveStore(env),actor:actor.uid}),200);
    }
    const result=await publishFolderAvailability({store:resolveStore(env),actor:actor.uid,data});
    return reply(result,result.pending?202:200);
   }catch(error){
    const status=[400,401,403,409,413,503].includes(error.status)?error.status:503;
    const code=/^FOLDER_POLICY_[A-Z_]+$/.test(error.code||'')?error.code:status===401?'FOLDER_POLICY_SESSION':'FOLDER_POLICY_UNAVAILABLE';
    return reply({code},status);
   }
  }
 };
}

// Folder mutations now enter through the FI actor verifier.
export default {fetch(){return Response.json({code:'FOLDER_POLICY_USE_FI'},{status:410,headers:{'Cache-Control':'no-store'}});}};
