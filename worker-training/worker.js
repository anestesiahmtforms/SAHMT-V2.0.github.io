import {assertFolderReadable} from '../server/folder-read-policy.js';
import {assertFeFolderReadable} from '../worker-fe-surveys/survey-policy.js';
import {createProfessionalRegistrationService} from './professional-registration-service.js';
import {createRegistrationDrive} from './registration-drive.js';
import {createBiosafetyManualService} from './biosafety-manual-service.js';
import {createDosimetryService} from './dosimetry-service.js';
import {createServiceTokenProvider,verifyTrainingIdentity} from './google-auth.js';
import {createFirestoreStore} from './firestore.js';
import {createHtmlTrainingService} from './service.js';
import {createVaccinationService} from './vaccination-service.js';
import {createProfessionalDocumentService} from './professional-documents.js';
import {createDriveClient} from './drive.js';
import {Buffer} from 'node:buffer';
import {createSurveyService} from './survey-service.js';
import {createYearEndStatusService} from './year-end-status-service.js';

const origins=['https://anestesiahmtforms.github.io'];
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
async function bodyJson(request,max,prefix){
 const length=Number(request.headers.get('Content-Length'));if(length>max)throw fail(prefix+'_INPUT_TOO_LARGE',413);
 const reader=request.body?.getReader();if(!reader)throw fail(prefix+'_INPUT_INVALID',400);
 let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw fail(prefix+'_INPUT_TOO_LARGE',413);chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(prefix+'_INPUT_INVALID',400);}
}
const runtimes=new WeakMap();
function sharedRuntime(env){
 if(!runtimes.has(env)){
  let credentials;try{credentials=JSON.parse(env.FB_TRAINING_SERVICE_ACCOUNT_JSON);}catch{throw fail('TRAINING_SERVICE_CONFIG_INVALID',503);}
  const getAccessToken=createServiceTokenProvider({credentials});
  const store=createFirestoreStore({getAccessToken});
  runtimes.set(env,{store,getAccessToken});
 }
 return runtimes.get(env);
}
function buildRuntime(env){
 const runtime=sharedRuntime(env);
 return runtime.training??=createHtmlTrainingService({store:runtime.store,now:Date.now,uuid:()=>crypto.randomUUID(),readingRequired:env.HTML_TRAINING_READING_REQUIRED==='true'});
}
const biosafetyFolder='gestao/area-gestao-de-pessoas/biosseguranca';
function vaccinationRuntime(env){
 const runtime=sharedRuntime(env);
 return runtime.vaccination??=folderGuard(runtime,createVaccinationService({store:runtime.store,adminDriveFolderUrl:env.PROFESSIONAL_DRIVE_FOLDER_URL}),'VAC',biosafetyFolder+'/vacinacao');
}
function dosimetryRuntime(env){const runtime=sharedRuntime(env);return runtime.dosimetry??=folderGuard(runtime,createDosimetryService({store:runtime.store}),'DOSIMETRY',biosafetyFolder+'/dosimetria');}
function manualRuntime(env){const runtime=sharedRuntime(env);return runtime.manual??=folderGuard(runtime,createBiosafetyManualService({store:runtime.store}),'MANUAL',biosafetyFolder+'/manual');}
function registrationDriveRuntime(env){const runtime=sharedRuntime(env);if(!runtime.registrationDrive){let config;try{config=JSON.parse(env.REGISTRATION_DRIVE_CLIENT_JSON||'null');}catch{}runtime.registrationDrive=createRegistrationDrive({store:runtime.store,clientConfig:config,encryptionKey:env.REGISTRATION_DRIVE_KEY});}return runtime.registrationDrive;}
function folderGuard(runtime,service,prefix,folder='consultas/cadastro-profissional') {
 async function check(folderId,identity) {
  try {
   if(identity?.emailVerified===true&&identity.provider==='google.com'&&identity.uid){
    const profile=await runtime.store.get('users',identity.uid);
    if(profile?.uid===identity.uid&&profile.email?.toLowerCase()===identity.email?.toLowerCase()&&
      profile.active===true&&profile.access===true&&(profile.role==='administrador_app'||profile.permissions?.admin===true))return;
   }
   const policy=await runtime.store.get('runtimePolicy','folders');
   if(policy!==null)assertFolderReadable(policy,folderId);
  } catch(error) {
   const disabled=error.code==='FOLDER_DISABLED';
   const code=prefix+(disabled?'_FOLDER_DISABLED':'_FOLDER_POLICY_UNAVAILABLE');
   throw Object.assign(Error(code),{code,status:disabled?403:503});
  }
 }
 return {async execute(...args){
  const folderId=typeof folder==='function'?folder(args[1]):folder;
  await check(folderId,args[2]);
  const result=await service.execute(...args);
  await check(folderId,args[2]);
  return result;
 }};
}
function registrationRuntime(env){const runtime=sharedRuntime(env);return runtime.registration??=folderGuard(runtime,createProfessionalRegistrationService({store:runtime.store,drive:registrationDriveRuntime(env)}),'REGISTRATION');}
function surveyRuntime(env){
 const runtime=sharedRuntime(env);
 let config;try{config=JSON.parse(env.REGISTRATION_DRIVE_CLIENT_JSON||'null');}catch{}
 return runtime.surveys??=createSurveyService({reportReaderEmail:config?.reportReaderEmail,checkSurvey:(folder,tx)=>assertFeFolderReadable(folder,runtime.getAccessToken,tx),profileStore:runtime.store,responseStore:createFirestoreStore({projectId:'outros-48120',getAccessToken:runtime.getAccessToken})});
}
function yearEndStatusRuntime(env){
 const runtime=sharedRuntime(env);
 return runtime.yearEndStatus??=createYearEndStatusService({store:createFirestoreStore({projectId:'outros-48120',getAccessToken:runtime.getAccessToken}),checkAvailability:()=>assertFeFolderReadable('consultas/escala-final-de-ano',runtime.getAccessToken,null,'YEAR_END')});
}
function documentRuntime(env){
 const runtime=sharedRuntime(env);
 if(!runtime.documents){
  let drive={ready:false};
  // An absent or malformed optional owner OAuth configuration cannot prevent
  // record access or document listing. Only the documents route reads it.
  if(env.DOCUMENT_UPLOADS_ENABLED==='true'&&env.PROFESSIONAL_DRIVE_OAUTH_JSON){
   try{drive=createDriveClient({credentials:JSON.parse(env.PROFESSIONAL_DRIVE_OAUTH_JSON)});}catch{drive={ready:false};}
  }
  runtime.documents=folderGuard(runtime,createProfessionalDocumentService({store:runtime.store,drive}),'DOCUMENT',input=>{
   if(input?.context==='VACCINATION')return biosafetyFolder+'/vacinacao';
   const root='gestao/area-gestao-de-pessoas/documentacao';
   const child={REGISTRATION:'cadastral',CERTIFICATES:'certificados',PROFESSIONAL:'profissional'}[input?.context];
   return typeof child==='string'?root+'/'+child:root;
  });
 }
 return runtime.documents;
}
const legacyTrainingCodes=new Set(['FOLDER_INDEX_REQUIRED','FOLDER_INDEX_TOO_LARGE','INSTITUTIONAL_REVIEW_REQUIRED','INVALID_INPUT','PAYLOAD_TOO_LARGE','UNSAFE_CONTENT','ALREADY_REVIEWED','ATTEMPT_LIMIT','AUDIT_IMMUTABLE','AUDIT_INVALID','AUDIT_UNAVAILABLE','BANK_QUESTIONS_REMOVED','CONTENT_UNAVAILABLE','FORBIDDEN','IDEMPOTENCY_CONFLICT','INVALID_ANSWERS','INVALID_MANAGER','NO_SUGGESTION','NOT_FOUND','NOT_PUBLISHED','READ_ORDER','RUN_CONFLICT','SCORE_UNAVAILABLE','SELF_REVIEW','STAGE_CONFLICT','UNAUTHENTICATED','VERSION_CHANGED','VERSION_CONFLICT']);
export function createTrainingWorker({verifyIdentity=verifyTrainingIdentity,buildService=buildRuntime,buildVaccinationService=vaccinationRuntime,buildDocumentService=documentRuntime,buildSurveyService=surveyRuntime,buildYearEndStatusService=yearEndStatusRuntime,buildDosimetryService=dosimetryRuntime,buildManualService=manualRuntime,buildRegistrationService=registrationRuntime,buildRegistrationDrive=env=>folderGuard(sharedRuntime(env),registrationDriveRuntime(env),'REGDRIVE')}={}){
 const routes={
  '/v1/professional-registration':{prefix:'REGISTRATION',max:64*1024,flag:'PROFESSIONAL_REGISTRATION_ENABLED',build:buildRegistrationService,sourceProject:'sahmt-17a16'},
  '/v1/registration-drive':{prefix:'REGDRIVE',max:8*1024*1024,flag:'PROFESSIONAL_REGISTRATION_ENABLED',build:buildRegistrationDrive,sourceProject:'sahmt-17a16'},
  '/v1/training':{prefix:'TRAINING',max:8*1024*1024,flag:'HTML_TRAINING_ENABLED',build:buildService},
  '/v1/vaccination':{prefix:'VAC',max:16*1024,flag:'VACCINATION_ENABLED',build:buildVaccinationService},
  '/v1/professional-documents':{prefix:'DOCUMENT',max:8*1024*1024,build:buildDocumentService},
  '/v1/biosafety-manual':{prefix:'MANUAL',max:1024,flag:'BIOSAFETY_MANUAL_ENABLED',build:buildManualService},
  '/v1/dosimetry':{prefix:'DOSIMETRY',max:4096,flag:'DOSIMETRY_ENABLED',build:buildDosimetryService},
  '/v1/institutional-surveys':{prefix:'SURVEY',max:32*1024,flag:'INSTITUTIONAL_SURVEYS_ENABLED',build:buildSurveyService,sourceProject:'sahmt-17a16'},
  '/v1/year-end-status':{prefix:'YEAR_END',max:1024,flag:'INSTITUTIONAL_SURVEYS_ENABLED',build:buildYearEndStatusService,sourceProject:'sahmt-17a16'},
 };
 return {async fetch(request,env={},context){
  const route=routes[new URL(request.url).pathname],prefix=route?.prefix||'TRAINING';
  const origin=request.headers.get('Origin');
  const allowed=origins.includes(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',...(allowed?{'Access-Control-Allow-Origin':origin}: {})};
  const reply=(data,status)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowed)return reply({code:prefix+'_ORIGIN_DENIED'},403);
  if(!route)return reply({code:'TRAINING_ROUTE_UNKNOWN'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Requested-With','Access-Control-Max-Age':'600'}});
  if(request.method!=='POST')return reply({code:prefix+'_METHOD_DENIED'},405);
  if(route.flag&&env[route.flag]!=='true')return reply({code:prefix+'_UNAVAILABLE'},503);
  try{
   if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw fail(prefix+'_INPUT_INVALID',400);
   const body=await bodyJson(request,route.max,prefix);
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!Object.hasOwn(body,'action')||typeof body.action!=='string'||!body.input||Array.isArray(body.input)||typeof body.input!=='object'||!Object.hasOwn(body,'input'))throw fail(prefix+'_INPUT_INVALID',400);
   if(prefix==='REGDRIVE'&&body.action==='CONNECT'&&request.headers.get('X-Requested-With')!=='SAHMT')throw fail('REGDRIVE_FORBIDDEN',403);
   const identity=await verifyIdentity(request.headers.get('Authorization'),{apiKey:route.sourceProject?env.FA_WEB_API_KEY:env.FB_WEB_API_KEY,...(route.sourceProject?{projectId:route.sourceProject}:{})});
   if(prefix==='DOCUMENT'&&body.action==='UPLOAD'&&env.DOCUMENT_UPLOADS_ENABLED!=='true')throw fail('DOCUMENT_DRIVE_NOT_CONNECTED',503);
   const result=await route.build(env).execute(body.action,body.input,identity);
   return reply(result,200);
  }catch(error){
   const safe=typeof error?.code==='string'&&(/^(?:TRAINING|VAC|DOCUMENT|SURVEY|DOSIMETRY|MANUAL|REGISTRATION|REGDRIVE|EPIDEMIOLOGICAL|YEAR_END)_[A-Z0-9_]{1,90}$/.test(error.code)||(prefix==='TRAINING'&&legacyTrainingCodes.has(error.code)))?error.code:prefix+'_UNAVAILABLE';
   return reply({code:safe,...(safe==='TRAINING_READING_REQUIRED'?{message:'Atualize o aplicativo e reabra o documento para validar a leitura completa.'}:{})},[400,401,403,404,409,413,422,429,503].includes(error?.status)?error.status:503);
  }
 }};
}
const legacyWorker = createTrainingWorker();
export default {
 fetch(request,env,context){
  if(new URL(request.url).pathname==='/v1/institutional-surveys'){
   const origin=request.headers.get('Origin');
   return Response.json({code:'SURVEY_RETIRED_IN_FA'},{status:410,headers:{'Cache-Control':'no-store',Vary:'Origin',
    ...(origins.includes(origin)?{'Access-Control-Allow-Origin':origin}:{})}});
  }
  return legacyWorker.fetch(request,env,context);
 }
};
