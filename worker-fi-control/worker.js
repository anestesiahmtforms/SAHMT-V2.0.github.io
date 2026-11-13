import {createFiFolderReader} from './folders.js';
import {createFolderPolicyStore} from '../worker-folder-policy/worker.js';
import {inspectFolderPublication,publishFolderAvailability} from '../worker-folder-policy/publication.js';
import {createServiceTokenProvider} from '../worker-fa-performance/service-token.js';
import {boundedJson} from '../worker-operational-domain/identity.js';
import {createFiStore,FI_PROJECTS,fiError} from './store.js';
import {createFiActorVerifier,createFiServiceToken} from './identity.js';
import {createFiAdminService} from './admin.js';
import {createFiSearch} from './search.js';
import {createMonthlyService} from './monthly.js';
import {createOpenAIProvider} from './ai-provider.js';
import {createFiSourceProvider,SOURCE_COLLECTIONS} from './sources.js';
import {createFiReadBudget,createFiRequestQuota} from './read-budget.js';
import {parseScheduleQuestion} from './personal-schedule.js';
import {refreshFiCatalogue} from './catalog-index.js';
const origin='https://anestesiahmtforms.github.io';
const isAdmin=actor=>actor.profile?.role==='administrador_app'||actor.profile?.permissions?.admin===true;
const publicControlActions=new Set(['search','service.status']);
const pilotActions=new Set(['search','monthly.generate','monthly.list','service.status']);
const adminReadActions=new Set(['people.list','admin.users.list','admin.requests.list','admin.categories.list','admin.features.get','updates.users','updates.read']);
export const pilotAccess=(actor,settings,action,now=Date.now())=>isAdmin(actor)&&pilotActions.has(action)&&
 settings?.schemaVersion===1&&settings.uid===actor.uid&&Number.isSafeInteger(settings.expiresAt)&&settings.expiresAt>now;
const searchReadPlan=Object.fromEntries(Object.entries({FA:4,FB:650,FJ:430,FH:210,FG:420,FF:105}).map(([alias,limit])=>[FI_PROJECTS[alias],limit]));
const catalogueCron='23 */6 * * *';
function boundedFetch(fetchImpl){
 let calls=0;
 return (url,options)=>{
  if(++calls>48)throw fiError('FI_EXTERNAL_REQUEST_LIMIT',429);
  return fetchImpl(url,options);
 };
}
function runtime(env,fetchImpl=fetch){
 let credentials;try{credentials=JSON.parse(env.FI_SERVICE_ACCOUNT_JSON||'null');}catch{throw fiError('FI_CONFIG_REQUIRED');}
 const getAccessToken=createFiServiceToken({credentials,fetchImpl});
 const store=createFiStore({projectId:FI_PROJECTS.FI,getAccessToken,fetchImpl});
 const sources=readBudget=>Object.fromEntries(Object.entries(SOURCE_COLLECTIONS).map(([alias,allowedCollections])=>[alias,createFiStore({projectId:FI_PROJECTS[alias],allowedCollections,getAccessToken,fetchImpl,readOnly:true,readBudget})]));
 const projections={FA:createFiStore({projectId:FI_PROJECTS.FA,getAccessToken,fetchImpl,allowedCollections:['users','accessRequests','appConfig']}),FJ:createFiStore({projectId:FI_PROJECTS.FJ,getAccessToken,fetchImpl,allowedCollections:['contacts','eventMembers']})};
 const trainingPolicy=createFiStore({projectId:FI_PROJECTS.FB,getAccessToken,fetchImpl,allowedCollections:['htmlTrainingSettings'],readOnly:true});
 const policyStore=createFiStore({projectId:FI_PROJECTS.FA,getAccessToken,fetchImpl,allowedCollections:['runtimePolicy'],readOnly:true});
 const folders=(administrator=false)=>createFiFolderReader({administrator,readPolicy:()=>policyStore.get('runtimePolicy','folders'),readTrainingPolicy:()=>trainingPolicy.get('htmlTrainingSettings','folders')});
 return {store,sources,projections,folders};
}
function folderPublisher(env,fetchImpl){
 const credentials=JSON.parse(env.FOLDER_POLICY_SERVICE_ACCOUNT_JSON||'null');
    return createFolderPolicyStore({getAccessToken:createServiceTokenProvider({credentials,fetchImpl:fetchImpl}),fetchImpl:fetchImpl});
}
export function createFiControlWorker({verifyActor,buildServices,buildFolderPublisher=folderPublisher,fetchImpl=fetch}={}){
 const createServices=buildServices||(async(env,rt,requestFetch,pilot,actor)=>{
  const settings=await rt.store.get('fiControlConfig','runtime');if(settings?.enabled!==true)throw fiError('FI_NOT_READY');
  const modelProvider=createOpenAIProvider({apiKey:env.FI_AI_ENABLED==='true'||pilot?env.OPENAI_API_KEY:undefined,fetchImpl:requestFetch});
  const guard=rt.folders(isAdmin(actor));
  const guardedModel={enabled:modelProvider.enabled,async generate(...args){await guard.recheck();return modelProvider.generate(...args);}};
  const monthlyBudgetMicros=pilot?Math.min(250000,pilot.monthlyBudgetMicros||0):settings.monthlyBudgetMicros;
  const admin=createFiAdminService({store:rt.store,projections:rt.projections});
  const quota=createFiRequestQuota({store:rt.store});
  const readBudget=createFiReadBudget({store:rt.store,projectLimits:{[FI_PROJECTS.FB]:14000}});
  async function boundedSearch(actor,input){
   await quota.consume(actor.uid);
   const question=parseScheduleQuestion(input.query);
   if(question){
    // One FJ profile query, one contact query and one date-specific read.
    const lease=await readBudget.open({[FI_PROJECTS.FJ]:question.status==='lookup'?7:3});
    try{
     const schedule=await createFiSourceProvider({stores:guard.wrap(rt.sources(lease))}).personalSchedule(actor,question);
     return {results:[],coverage:[],schedule};
    }finally{await lease.finish().catch(()=>{});}
   }
   const lease=await readBudget.open(searchReadPlan);
   try{
    const indexStore={async get(...args){
     await guard.checkHtmlLibrary();
     return rt.store.get(...args);
    }};
    const sourceProvider=createFiSourceProvider({stores:guard.wrap(rt.sources(lease)),indexStore});
    return await createFiSearch({sourceProvider})(actor,input);
   }finally{await lease.finish().catch(()=>{});}
  }
  return {async dispatch(actor,action,input){
   if(action==='search'){
    await guard.start();
    const result=await boundedSearch(actor,input);
    await guard.recheck();
    return result;
   }
   if(action==='monthly.generate'){
    await guard.checkMonthly();
    const result=await createMonthlyService({store:rt.store,sourceProvider:createFiSourceProvider({stores:guard.wrap(rt.sources())}),modelProvider:guardedModel,config:{monthlyBudgetMicros,dailyUserLimit:pilot?3:settings.dailyUserLimit}})(actor,input);
    await guard.recheck();
    return result;
   }
   if(action==='monthly.list'){
    if(!isAdmin(actor))throw fiError('FI_FORBIDDEN',403);
    await guard.checkMonthly();
    const units=new Set(await createFiSourceProvider({stores:guard.wrap(rt.sources())}).monthlyAccess(actor));
    const rows=(await rt.store.list('fiAiRuns',[{field:'status',op:'EQUAL',value:'complete'}],101))
     .filter(row=>Array.isArray(row.units)&&row.units.length>0&&row.units.every(unit=>units.has(unit)))
     .sort((a,b)=>b.period.localeCompare(a.period));
    await guard.recheck();
    return rows;
   }
   if(action==='service.status')return {station:'FI',purpose:'ADMINISTRATIVE_CONTROL_AND_AI',aiEnabled:modelProvider.enabled,monthlyEnabled:env.FI_MONTHLY_ENABLED==='true',pilot:!!pilot,...(isAdmin(actor)?{monthlyBudgetMicros:monthlyBudgetMicros||0,folderManagement:!pilot&&env.FI_FOLDER_MANAGEMENT_ENABLED==='true'}:{} )};
   if(!adminReadActions.has(action)&&settings.adminWritesEnabled!==true)throw fiError('FI_ADMIN_CUTOVER_PENDING');
   if(action.startsWith('people.'))await guard.assertOpen('operacao/pessoas');
   const result=await admin.execute({actor,action,input});
   if(action.startsWith('people.'))await guard.recheck();
   return result;
  }};
 });
 return {async fetch(request,env){
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin'},json=(data,status=200)=>Response.json(data,{status,headers});
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET')return json({station:'FI',projectId:FI_PROJECTS.FI,purpose:'ADMINISTRATIVE_CONTROL_AND_AI',controlEnabled:env.FI_CONTROL_ENABLED==='true',aiEnabled:env.FI_AI_ENABLED==='true'&&!!env.OPENAI_API_KEY,monthlyEnabled:env.FI_MONTHLY_ENABLED==='true',pilotEnabled:env.FI_PILOT_ENABLED==='true'});
  if(request.headers.get('Origin')!==origin)return json({code:'FI_ORIGIN_DENIED'},403);
  Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Firebase-AppCheck'});
  const pilotRoute=url.pathname==='/v1/pilot';
  if((!pilotRoute&&url.pathname!=='/v1/control')||url.search)return json({code:'FI_NOT_FOUND'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return json({code:'FI_METHOD_DENIED'},405);
  try{
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fiError('FI_INPUT_INVALID',400);
   if(Number(request.headers.get('Content-Length'))>196608)throw fiError('FI_BODY_LIMIT',413);
   if(pilotRoute?env.FI_PILOT_ENABLED!=='true'||env.FI_REQUIRE_APP_CHECK!=='true':env.FI_CONTROL_ENABLED!=='true')throw fiError('FI_NOT_READY');
   const requestFetch=boundedFetch(fetchImpl),rt=verifyActor&&buildServices?null:runtime(env,requestFetch);
   const actor=await (verifyActor||createFiActorVerifier({store:rt.store,fetchImpl:requestFetch}))(request,env);
   const body=await boundedJson(request,196608);
   if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['action','input'].includes(k))||typeof body.action!=='string'||!/^[a-z][A-Za-z0-9.]{0,80}$/.test(body.action)||!body.input||Array.isArray(body.input)||typeof body.input!=='object')throw fiError('FI_INPUT_INVALID',400);
   if(!publicControlActions.has(body.action)&&!isAdmin(actor))throw fiError('FI_FORBIDDEN',403);
   let pilot;
   if(pilotRoute){
    pilot=await rt.store.get('fiControlConfig','pilot');
    if(!pilotAccess(actor,pilot,body.action))throw fiError('FI_FORBIDDEN',403);
   }
   if(['folders.inspect','folders.publish'].includes(body.action)){
    if(pilotRoute||!isAdmin(actor))throw fiError('FI_FORBIDDEN',403);
    if(env.FI_FOLDER_MANAGEMENT_ENABLED!=='true')throw fiError('FI_NOT_READY');
    const publisher=buildFolderPublisher(env,requestFetch);
    const store={...publisher,profile:async uid=>uid===actor.uid?{...actor.profile,uid}:null};
    if(body.action==='folders.inspect'){
     if(Object.keys(body.input).length)throw fiError('FI_INPUT_INVALID',400);
     return json(await inspectFolderPublication({store,actor:actor.uid}));
    }
    const result=await publishFolderAvailability({store,actor:actor.uid,data:body.input});
    return json(result,result.pending?202:200);
   }
   return json(await (await createServices(env,rt,requestFetch,pilot,actor)).dispatch(actor,body.action,body.input));
  }catch(error){
   const code=/^[A-Z0-9_]{1,100}$/.test(error.code||error.message||'')?(error.code||error.message):'FI_UNAVAILABLE';
   const status=[400,401,403,404,409,413,429,503].includes(error.status)?error.status:code==='FORBIDDEN'?403:/INVALID|REQUIRED$/.test(code)?400:503;
   return json({code},status);
  }
 },async scheduled(controller,env,ctx){
  if(controller.cron===catalogueCron){
   if(env.FI_CONTROL_ENABLED!=='true')return;
   ctx.waitUntil((async()=>{
    const rt=runtime(env,boundedFetch(fetchImpl));
    const folders=rt.folders();
    await folders.checkHtmlLibrary();
    await refreshFiCatalogue({source:folders.wrap(rt.sources()).FB,target:rt.store,verifyPolicy:()=>folders.recheck()});
   })().catch(()=>console.error(JSON.stringify({code:'FI_CATALOGUE_REFRESH_FAILED'}))));
   return;
  }
  if(env.FI_CONTROL_ENABLED!=='true'||env.FI_MONTHLY_ENABLED!=='true'||env.FI_AI_ENABLED!=='true'||!env.OPENAI_API_KEY||!env.FI_MONTHLY_ADMIN_UID)return;
  ctx.waitUntil((async()=>{
   const requestFetch=boundedFetch(fetchImpl),rt=runtime(env,requestFetch),uid=env.FI_MONTHLY_ADMIN_UID,link=await rt.store.get('fiAdminIdentityLinks',uid),local=link?.active===true?await rt.store.get('users',link.fiUid):null,managed=await rt.store.get('fiAdminUsers',uid),gate=await rt.sources().FA.get('users',uid);
   if(managed&&(managed.uid!==uid||managed.email?.toLowerCase()!==link?.email?.toLowerCase()))throw fiError('FI_MONTHLY_ACTOR_DENIED',403);
   const profile=local&&managed?{...local,...managed,uid:link.fiUid}:local;
   if(!link||!profile||!gate||gate.uid!==uid||gate.active!==true||gate.access!==true||link.faUid!==uid||profile.uid!==link.fiUid||profile.active!==true||profile.access!==true||profile.email?.toLowerCase()!==link.email?.toLowerCase()||gate.email?.toLowerCase()!==link.email?.toLowerCase())throw fiError('FI_MONTHLY_ACTOR_DENIED',403);
   const actor={uid,fiUid:link.fiUid,email:link.email,identityLink:link,profile,memberCategories:[]};if(!isAdmin(actor))throw fiError('FI_MONTHLY_ACTOR_DENIED',403);
   const date=new Date(controller.scheduledTime||Date.now()),month=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-1,1)).toISOString().slice(0,7);
   const result=await (await createServices(env,rt,requestFetch)).dispatch(actor,'monthly.generate',{period:month,requestId:'scheduled_'+month});console.log(JSON.stringify({code:'FI_MONTHLY_RUN',period:month,status:result.status}));
  })().catch(()=>console.error(JSON.stringify({code:'FI_MONTHLY_FAILED'}))));
 }};
}
export default createFiControlWorker();
