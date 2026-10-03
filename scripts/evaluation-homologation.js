import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const HOMOLOGATION_PROJECT = 'demo-sahmt-v2';
const GS_FILES = ['Config.gs', 'ChecklistValidation.gs', 'ChecklistProjection.gs', 'EvaluationLedger.gs', 'FormsEvaluation.gs'];
const PROTECTED_FORMS = new Set(['1NFqJHXOiHInHtQlmZMOTKHgjgmeYB4TxJ9s2p8xRTmc', '1z-T7EL_FN1blDQa9Cn8SybHV_pJOr1dnVObVtHXtcmc']);
const plain = value => JSON.parse(JSON.stringify(value));

// No production project, DNS name, token, redirect, or arbitrary URL is accepted.
export function validateEmulatorTarget(projectId, emulatorHost) {
  if (projectId !== HOMOLOGATION_PROJECT) throw new Error('Only demo-sahmt-v2 is permitted.');
  if (typeof emulatorHost !== 'string' || !/^(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/.test(emulatorHost)) throw new Error('A loopback Firestore emulator host and port are required.');
  const url = new URL(`http://${emulatorHost}`);
  if (Number(url.port) < 1 || Number(url.port) > 65535 || url.username || url.password) throw new Error('Invalid emulator port or credentials.');
  return Object.freeze({projectId, origin:url.origin, documents:`${url.origin}/v1/projects/${projectId}/databases/(default)/documents`});
}

export function validateReplayCapture(capture) {
  if (!capture || capture.schemaVersion !== 1 || capture.purpose !== 'ISOLATED_EVALUATION_HOMOLOGATION' || capture.source !== 'FORMS_HOMOLOGATION_CAPTURE' || capture.productionFinancialWrites !== false) throw new Error('Unsupported private homologation capture.');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(capture.formId || '') || PROTECTED_FORMS.has(capture.formId)) throw new Error('Protected or invalid Form must not be replayed.');
  if (!capture.metadata || capture.metadata.formId !== capture.formId || !String(capture.metadata.info?.title || '').startsWith('[HOMOLOGAÇÃO SAHMT]') || capture.metadata.settings?.emailCollectionType !== 'VERIFIED') throw new Error('A dedicated VERIFIED homologation Form is required.');
  const roles=capture.roles || {}, ids=[roles.participantUid,roles.managerUid,roles.reviewerUid];
  if (ids.some(id=>typeof id !== 'string' || !id) || new Set(ids).size !== 3 || !Array.isArray(capture.profiles) || capture.profiles.length !== 3) throw new Error('Three independent approved identities are required.');
  const profiles=new Map(capture.profiles.map(profile=>[profile.uid,profile]));
  const emails=capture.profiles.map(profile=>String(profile.email || '').trim().toLowerCase());
  if (profiles.size!==3 || new Set(emails).size!==3 || emails.some(email=>!/^\S+@\S+\.\S+$/.test(email)) || ids.some(id=>{const p=profiles.get(id);return !p || (p.id && p.id!==id) || p.active!==true || p.access!==true;})) throw new Error('Capture profiles are inactive, ambiguous, or do not match the roles.');
  const admin=p=>p.role==='administrador_app' || p.permissions?.admin===true;
  if (!admin(profiles.get(roles.reviewerUid)) || admin(profiles.get(roles.participantUid))) throw new Error('An independent administrative reviewer and ordinary participant are required.');
  const cfg=capture.config, activity=capture.activity, area=capture.area, assignment=capture.assignment;
  if (!area || !/^[A-Za-z0-9_-]{1,200}$/.test(area.id || '') || !assignment || !Number.isInteger(assignment.version) || assignment.version<1 || !cfg || !Number.isInteger(cfg.version) || cfg.version<1 || !Number.isInteger(cfg.configVersion) || cfg.configVersion<1 || !/^[A-Za-z0-9_-]{1,200}$/.test(cfg.creditScopeId || '') || cfg.formId!==capture.formId || cfg.status!=='READY' || !Array.isArray(cfg.eligibleUids) || cfg.eligibleUids.length!==3 || ids.some(id=>!cfg.eligibleUids.includes(id)) || !activity || activity.active!==true || activity.status!=='READY' || !area || area.active!==true || cfg.managerAreaId!==area.id || !assignment || assignment.areaId!==area.id || assignment.uid!==roles.managerUid || cfg.managerUid!==roles.managerUid) throw new Error('READY activity, current assignment, and exactly three eligible identities are required.');
  if (!Array.isArray(capture.responses) || capture.responses.length>25 || new Set(capture.responses.map(response=>response.responseId)).size!==capture.responses.length) throw new Error('Capture response budget or identities are invalid.');
  for (const response of capture.responses) {
    if (!response.responseId || response.formId && response.formId!==capture.formId || !emails.includes(String(response.respondentEmail || '').trim().toLowerCase())) throw new Error('Response identity does not belong to the private approved capture.');
  }
  return capture;
}

// Separate Node process gives synchronous GAS REST semantics while the emulator
// remains a real independent process. Input is stdin; neither credentials nor
// response content are printed. Only this constant emulator-owner marker is used.
const HTTP_CHILD = String.raw`
const fs=require('node:fs');
(async()=>{
  const input=JSON.parse(fs.readFileSync(0,'utf8'));
  const target=new URL(input.url), origin=new URL(input.origin);
  if(input.projectId!=='demo-sahmt-v2' || target.origin!==origin.origin || target.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.username || target.password || target.hash || !/^\/v1\/projects\/demo-sahmt-v2\/databases\/\(default\)\/documents(?:$|[:/])/.test(target.pathname)) throw Error('Unsafe replay URL');
  if(!['GET','POST','PATCH'].includes(input.method)) throw Error('Unsafe replay method');
  if(input.body && JSON.stringify(input.body).includes('projects/sahmt-17a16/')) throw Error('Production resource name rejected');
  const response=await fetch(target,{method:input.method,redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json',authorization:'Bearer owner'},...(input.body?{body:JSON.stringify(input.body)}:{})});
  const text=await response.text(); let body;try{body=text?JSON.parse(text):{};}catch{throw Error('Emulator returned non-JSON');}
  process.stdout.write(JSON.stringify({status:response.status,body}));
})().catch(error=>{process.stderr.write('Local emulator transport failed: '+String(error.name || 'Error')+' '+String(error.cause?.code || '')+'.');process.exitCode=1;});
`;

export function createEmulatorReplay({projectId=HOMOLOGATION_PROJECT, emulatorHost=process.env.FIRESTORE_EMULATOR_HOST, operatorEmail='operator@example.invalid'}={}) {
  const target=validateEmulatorTarget(projectId,emulatorHost), requests=[], properties=new Map([['SAHMT_V2_EVALUATION_ALLOWED_EMAILS',operatorEmail]]), google=new Map();
  const sourceHashes={};
  const source=GS_FILES.map(file=>{const text=readFileSync(new URL(`../apps-script-v2/${file}`,import.meta.url),'utf8');sourceHashes[file]=createHash('sha256').update(text).digest('hex');return text;}).join('\n');
  const ctx=vm.createContext({Date,Map,Set,JSON,Number,Object,Array,String,RegExp,Error,Math,encodeURIComponent,decodeURIComponent,
    console:{log:()=>{},error:()=>{}}, Session:{getEffectiveUser:()=>({getEmail:()=>operatorEmail})},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(_,text)=>Array.from(createHash('sha256').update(text).digest()),formatDate:date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    ScriptApp:{getOAuthToken:()=>{throw new Error('No OAuth credentials in isolated replay.');},getProjectTriggers:()=>[],newTrigger:()=>{throw new Error('Triggers prohibited in isolated replay.');}},
    UrlFetchApp:{fetch:()=>{throw new Error('Uncaptured external network is prohibited.');}},
    FormApp:{openById:()=>{throw new Error('Live Google Form mutation prohibited.');},openByUrl:()=>{throw new Error('Live Google Form access prohibited.');}}});
  vm.runInContext(source,ctx,{filename:'unchanged-evaluation-apps-script.gs'});
  const name=(collection,id)=>`projects/${projectId}/databases/(default)/documents/${collection}/${id}`;
  const transport=(url,options={})=>{
    const parsed=new URL(url);
    if(parsed.origin!==target.origin || !/^\/v1\/projects\/demo-sahmt-v2\/databases\/\(default\)\/documents(?:$|[:/])/.test(parsed.pathname) || parsed.hash || parsed.username || parsed.password) throw new Error('External or production URL rejected before any network request.');
    const body=options.payload ? JSON.parse(options.payload) : undefined;
    if(body && JSON.stringify(body).includes('projects/sahmt-17a16/')) throw new Error('Production resource names rejected.');
    const method=String(options.method||'GET').toUpperCase();
    const output=execFileSync(process.execPath,['-e',HTTP_CHILD],{input:JSON.stringify({projectId,origin:target.origin,url,method,body}),encoding:'utf8',timeout:65000,maxBuffer:16*1024*1024,windowsHide:true,env:Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP'].filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]))});
    const result=JSON.parse(output);requests.push({method,path:parsed.pathname,status:result.status,writeCount:body?.writes?.length||0});
    if(result.status<200 || result.status>=300) throw Object.assign(new Error(`Firestore emulator HTTP ${result.status}.`),{status:result.status});
    return result.body;
  };
  // Transport / provider bindings only. No planner, validator, transaction,
  // authorization gate, correction, or summarizer is replaced.
  ctx.firestoreDocumentsUrl_=path=>target.documents+path;
  ctx.firestoreDocumentName_=name;
  ctx.firestoreRequest_=transport;
  ctx.formsEvaluationGoogleRequest_=url=>{if(!google.has(url))throw new Error('External Google request has no captured fixture.');return structuredClone(google.get(url));};
  const seed=(collection,id,fields)=>transport(`${target.documents}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,{method:'PATCH',payload:JSON.stringify({fields:ctx.firestoreFieldsFromJs_(fields)})});
  const get=(collection,id)=>{const result=ctx.evaluationGet_(collection,id);return result?plain(ctx.evaluationClean_(result)):null;};
  const values=collection=>plain(ctx.evaluationQuery_(collection,[],[],10000).map(doc=>ctx.evaluationClean_(doc)));
  const enable=()=>{properties.set('SAHMT_V2_EVALUATION_ENABLED','true');properties.set('SAHMT_V2_EVALUATION_HOMOLOGATED','true');seed('evaluationRuntime','state',{homologationVerified:true});};
  const invoke=(method,payload,actorUid)=>{ctx.evaluationAssertOperator_(true);return ctx.evaluationRunTransaction_(tx=>ctx[method](payload,actorUid,tx));};
  return {ctx,target,sourceHashes,requests,properties,google,seed,get,values,enable,invoke,transport};
}

function reviveConfig(config) {
  const result=structuredClone(config);
  for(const key of ['validFrom','validUntil','firstEligibleAt']) {result[key]=new Date(result[key]);if(!Number.isFinite(result[key].getTime()))throw new Error(`Capture missing valid ${key}.`);}
  return result;
}
export function seedReplayCapture(replay,input) {
  const capture=validateReplayCapture(input), {seed,google}=replay, cfg=reviveConfig(capture.config);
  capture.profiles.forEach(p=>seed('users',p.uid,p));
  seed('evaluationFormConfigs',capture.formId,cfg);seed('evaluationActivities',capture.formId,capture.activity);seed('managementAreas',capture.area.id,capture.area);
  seed('evaluationAssignments',capture.area.id,{...capture.assignment,effectiveAt:new Date(capture.assignment.effectiveAt)});
  (capture.assignmentHistory || []).forEach(history=>seed('evaluationAssignmentHistory',history.id,{...history,effectiveAt:new Date(history.effectiveAt)}));
  google.set(`https://forms.googleapis.com/v1/forms/${capture.formId}`,capture.metadata);
  capture.responses.forEach(response=>google.set(`https://forms.googleapis.com/v1/forms/${capture.formId}/responses/${response.responseId}`,response));
  replay.enable();
  return capture;
}

export function replayPrivateCapture(replay,capture) {
  seedReplayCapture(replay,capture);const outcomes=[];
  for(const response of capture.responses) {replay.ctx.evaluationAssertOperator_(true);outcomes.push(replay.ctx.formsEvaluationProcessResponse_(capture.formId,response.responseId));}
  replay.ctx.initializeEvaluationCategoryState_('PERFORMANCE');replay.ctx.initializeEvaluationCategoryState_('GOVERNANCE');
  replay.ctx.evaluationPublishCategorySummary_('PERFORMANCE');replay.ctx.evaluationPublishCategorySummary_('GOVERNANCE');
  const before=replay.values('evaluationLedger').length;
  for(const response of capture.responses)replay.ctx.formsEvaluationProcessResponse_(capture.formId,response.responseId);
  const after=replay.values('evaluationLedger').length;
  if(before!==after)throw new Error('Replayed response duplicated ledger credit.');
  return {projectId:HOMOLOGATION_PROJECT,transport:'REAL_FIRESTORE_EMULATOR',sourceHashes:replay.sourceHashes,responses:outcomes.length,confirmed:outcomes.filter(outcome=>outcome.status==='CONFIRMED').length,pending:outcomes.filter(outcome=>outcome.status!=='CONFIRMED').length,awards:replay.values('evaluationAwards').length,ledgerEntries:after,duplicateReplayVerified:true,remoteAppsScriptExecuted:false,productionTriggersActivated:false};
}

export function fictionalReplayCapture(replay) {
  const formId='HomologationFixture123456',areaId='homologation-area',roles={participantUid:'fictional-participant',managerUid:'fictional-manager',reviewerUid:'fictional-reviewer'};
  const question=(id,title,points=0,extra={})=>({itemId:`item-${id}`,title,questionItem:{question:{questionId:id,grading:{pointValue:points,...(points?{correctAnswers:{answers:[{value:'A'}]}}:{})},...(points?{choiceQuestion:{type:'RADIO',options:[{value:'A'},{value:'B'}]}}:{textQuestion:{paragraph:true}}),...extra}}});
  const metadata={formId,info:{title:'[HOMOLOGAÇÃO SAHMT] Matéria inteiramente fictícia'},responderUri:'https://docs.google.com/forms/d/e/FictionalPublicAlias123456/viewform',settings:{emailCollectionType:'VERIFIED',quizSettings:{isQuiz:true}},items:[question('ack','[SAHMT:ACK] Ciência',0,{choiceQuestion:{type:'RADIO',options:[{value:'SIM'},{value:'NÃO'}]}}),question('problem','[SAHMT:SUGGESTION_PROBLEM] Problema'),question('proposal','[SAHMT:SUGGESTION_PROPOSAL] Proposta'),question('benefit','[SAHMT:SUGGESTION_BENEFIT] Benefício'),question('test','Questão fictícia de cinco pontos',5)]};
  const configuration=replay.ctx.formsEvaluationConfiguration_(metadata,{modalities:{acknowledgement:true,suggestion:true,test:true}});
  const profiles=Object.values(roles).map((uid,index)=>({id:uid,uid,email:`${uid}@example.invalid`,displayName:`Pessoa fictícia ${index+1}`,sigla:['AA','BB','CC'][index],active:true,access:true,role:index===2?'administrador_app':'usuario',permissions:{checklistSign:true}}));
  const config={id:formId,formId,status:'READY',creditScopeId:'homologation-matter',version:1,configVersion:1,eligibleUids:Object.values(roles),managerAreaId:areaId,managerUid:roles.managerUid,assignmentId:areaId,modalities:{acknowledgement:true,suggestion:true,test:true},...plain(configuration),responderUrl:metadata.responderUri,materialUrls:[],materialSnapshot:[],materialFingerprint:replay.ctx.formsEvaluationHash_([]),validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-12-31T23:59:59.000Z',firstEligibleAt:'2026-01-01T00:00:00.000Z'};
  const assignment={id:areaId,areaId,uid:roles.managerUid,version:1,effectiveAt:'2026-01-01T00:00:00.000Z'};
  const answer=value=>({textAnswers:{answers:[{value}]}});
  const response={formId,responseId:'fixture-response',respondentEmail:profiles[0].email,createTime:new Date().toISOString(),answers:{ack:answer('SIM'),problem:answer('Problema operacional inteiramente fictício'),proposal:answer('Proposta original para exercício controlado'),benefit:answer('Benefício esperado neste exercício fictício'),test:answer('A')}};
  return {schemaVersion:1,purpose:'ISOLATED_EVALUATION_HOMOLOGATION',source:'FORMS_HOMOLOGATION_CAPTURE',productionFinancialWrites:false,formId,metadata,config,activity:{id:formId,formId,active:true,status:'READY',areaIds:[areaId],eligibleUids:Object.values(roles)},profiles,roles,area:{id:areaId,active:true},assignment,assignmentHistory:[{...assignment,id:'assignment-'+replay.ctx.formsEvaluationHash_(`${areaId}\0${1}`)}],responses:[response],responseStates:[],evidence:{fictional:true,pendingGrades:1}};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),projectIndex=args.indexOf('--project'),captureIndex=args.indexOf('--capture');
    if(projectIndex<0 || args[projectIndex+1]!==HOMOLOGATION_PROJECT) throw new Error('Pass --project demo-sahmt-v2 explicitly.');
    const replay=createEmulatorReplay({projectId:args[projectIndex+1]});
    const capture=captureIndex>=0 ? JSON.parse(readFileSync(args[captureIndex+1],'utf8')) : args.includes('--fictional') ? fictionalReplayCapture(replay) : null;
    if(!capture)throw new Error('Pass --fictional or an ignored private --capture file.');
    process.stdout.write(JSON.stringify(replayPrivateCapture(replay,capture),null,2)+'\n');
  } catch(error) {process.stderr.write(`Isolated homologation failed: ${error.message}\n`);process.exitCode=1;}
}
