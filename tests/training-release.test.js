import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const source = ['EvaluationLedger.gs','FormsEvaluation.gs','TrainingRelease.gs'].map(file => readFileSync(new URL(`../apps-script-v2/${file}`, import.meta.url), 'utf8')).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const copy = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const operator = 'operator@example.invalid';
const area = 'area-gestao-de-documentos';
const roots = [
  ['1ZVHg-9fcnBv1q8PJgFoUGQ50b5EwAggR','GENERAL',18,'DOCUMENT'],
  ['1jwZn5MeuvsSoyHROk_dNS-mXL1teVfBc','RESTRICTED',14,'DOCUMENT'],
  ['1gg78vHm0O07B_McXFaMMi_ByGwbbWt-7','GENERAL',13,'DOCUMENT'],
  ['1N0lTv1vewXW_bqhBhN2QG8cq75ZzXdR8','GENERAL',31,'ROP']
];

function fixture() {
  const properties = new Map(), store = new Map(), files = new Map(), forms = new Map(), metadata = new Map(), commits = [], logs = [], checks = [], triggers = [], removedTriggers = [];
  const mutations = [], readbacks = [], waves = [], formOperations = [];
  let serial = 0, inTransaction = false, time = Date.parse('2026-10-06T15:00:00Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const ctx = vm.createContext({Date: Clock, Map, Set, JSON, Number, Object, Array, String, RegExp, Error, Math, encodeURIComponent,
    Utilities: {DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(_,text)=>Array.from(createHash('sha256').update(text).digest()),
      formatDate:date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date),getUuid:()=>`uuid-${++serial}`},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
    Session:{getEffectiveUser:()=>({getEmail:()=>operator})},
    Logger:{log:value=>logs.push(value)},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    ScriptApp:{TriggerSource:{CLOCK:'CLOCK'},EventType:{CLOCK:'CLOCK'},getOAuthToken:()=> 'synthetic-token',getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{assert.equal(minutes,5);const id=`trigger-${++serial}`;const t={getUniqueId:()=>id,getHandlerFunction:()=>handler,getTriggerSource:()=> 'CLOCK',getEventType:()=> 'CLOCK'};triggers.push(t);return t;}})})}),deleteTrigger:t=>{removedTriggers.push(t.getUniqueId());triggers.splice(triggers.indexOf(t),1);}},
    DriveApp:{Access:{PRIVATE:'PRIVATE'},getFileById:id=>{if(!files.has(id))throw Error('sensitive inaccessible file');return files.get(id);}},
    FormApp:{openById:id=>{if(!forms.has(id))throw Error('sensitive inaccessible form');return forms.get(id);}}
  });
  vm.runInContext(source,ctx);
  const get = (collection,id) => store.has(`${collection}/${id}`) ? copy(store.get(`${collection}/${id}`)) : null;
  const seed = (collection,id,data) => store.set(`${collection}/${id}`,{...copy(data),id,_updateTime:`v${++serial}`});
  ctx.sha256Hex_ = hash;
  ctx.sahmtV2Properties_ = () => ctx.PropertiesService.getScriptProperties();
  ctx.firestoreFilter_ = (field,op,value) => ({field:{fieldPath:field},op,value});
  ctx.evaluationGet_ = get;
  ctx.formsEvaluationAll_ = (collection, filters=[]) => [...store.entries()].filter(([key])=>key.startsWith(`${collection}/`)).map(([,value])=>copy(value)).filter(value=>filters.every(filter=>value[filter.field.fieldPath]===filter.value.stringValue));
  ctx.evaluationWrite_ = (collection,id,changes,previous=null,times=[]) => ({collection,id,changes:copy(changes),previous:copy(previous),times});
  ctx.evaluationRunTransaction_ = callback => {
    assert.equal(inTransaction,false); inTransaction=true;
    let plan; try { plan=callback('transaction'); } finally { inTransaction=false; }
    for(const write of plan.writes) { const current=get(write.collection,write.id);assert.equal(current?._updateTime,write.previous?._updateTime,'CAS comparison'); }
    for(const write of plan.writes) { const patch=copy(write.changes);for(const key of write.times)patch[key]=new Clock();seed(write.collection,write.id,{...(get(write.collection,write.id)||{}),...patch}); }
    commits.push(copy(plan.writes)); return plan.result;
  };
  const nativeOperator = ctx.evaluationAssertOperator_;
  ctx.evaluationAssertOperator_ = activation => { checks.push(activation);return nativeOperator(activation); };
  ctx.trainingDocumentsHash_ = value => ctx.formsEvaluationHash_(value);
  ctx.trainingDocumentsVerifyItems_ = (live,items,ids) => {
    assert.deepEqual(plain(live.items),plain(items));
    assert.deepEqual(plain(ids),plain(Object.fromEntries(items.map(item=>[item.itemId,item.questionItem?.question.questionId||null]))));
  };
  ctx.ropsSecondSemesterComparable_ = live => live.items.filter(item=>!item.title.startsWith('[SAHMT:'));
  ctx.evaluationApplyAwards_ = () => { throw Error('Financial writes prohibited in release'); };
  const response = (status, value) => ({getResponseCode:()=>status,getContentText:()=>JSON.stringify(value)});
  function googleRequest(url, options={}) {
    const method=String(options.method||'get').toLowerCase();
    const formRoute=url.match(/^https:\/\/forms\.googleapis\.com\/v1\/forms\/([^/?]+)(?:\/responses.*)?$/);
    if(formRoute)return copy(url.includes('/responses')?{}:metadata.get(formRoute[1]));
    const route=url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/?]+)(?:\/permissions(?:\/([^?]+))?)?\?/);
    if(!route)throw Error('Unexpected sensitive Google request');
    const id=decodeURIComponent(route[1]),permissionId=route[2]&&decodeURIComponent(route[2]),file=files.get(id),form=forms.get(id);
    if(!file&&!form)throw Error('sensitive inaccessible file');
    if(file?.failDrive)throw Error('sensitive Drive 403');
    const permissions=form?form.permissions:file.permissions;
    const permissionRequest=url.includes('/permissions?')||url.includes('/permissions/');
    if(method==='get') {
      readbacks.push({id,kind:permissionRequest?'permissions':'metadata'});
      return copy(permissionRequest?{permissions}:file.ownerMetadata);
    }
    assert.equal(inTransaction,false,'native Drive writes remain outside Firestore transactions');
    const payload=options.payload?JSON.parse(options.payload):{};
    if(method==='post')assert.equal(new URL(url).searchParams.get('sendNotificationEmail'),'false','native grants disable notifications');
    if(!form && file.ownerMetadata?.mimeType==='application/vnd.google-apps.folder') {
      assert.equal(id,roots[3][0],'only the cloned ROP folder is mutable');
      assert.equal(permissionRequest&&['post','patch'].includes(method),false,'no folder reader or writer grafts');
    }
    mutations.push({id,method,permissionId,payload:copy(payload),permissionRequest});
    if(permissionRequest) {
      if(method==='delete') {const index=permissions.findIndex(p=>p.id===permissionId);if(index>=0)permissions.splice(index,1);return {};}
      if(method==='post') {if(form?.failAdd||file?.failAdd)throw Error('sensitive ACL failure');permissions.push({id:`grant-${++serial}`,...payload});return {};}
      if(method==='patch') {const permission=permissions.find(p=>p.id===permissionId);if(!permission)throw Error('sensitive permission missing');Object.assign(permission,payload);return copy(permission);}
    }
    if(method==='patch') {Object.assign(file.ownerMetadata,payload);return copy(file.ownerMetadata);}
    throw Error('Unexpected native mutation');
  }
  ctx.formsEvaluationGoogleRequest_=googleRequest;
  ctx.UrlFetchApp={
    fetch:(url,options)=>{try{return response(200,googleRequest(url,options));}catch(error){return response(403,{error:{message:error.message}});}},
    fetchAll:requests=>{
      const ids=requests.map(request=>decodeURIComponent(request.url.match(/\/files\/([^/?]+)/)[1]));
      assert.equal(new Set(ids).size,ids.length,'a Drive wave never operates on one file twice in parallel');
      assert.ok(ids.length<=84,'material waves contain at most 84 distinct files');
      waves.push(requests.map(request=>({id:decodeURIComponent(request.url.match(/\/files\/([^/?]+)/)[1]),method:String(request.method||'get').toLowerCase(),url:request.url})));
      return requests.map(request=>{try{return response(200,googleRequest(request.url,request));}catch(error){return response(403,{error:{message:error.message}});}});
    }
  };
  function parents(values) { let index=0;return {hasNext:()=>index<values.length,next:()=>values[index++]}; }
  const folders=Object.fromEntries(roots.map(([id])=>[id,{getId:()=>id,getParents:()=>parents([])}]));
  const originalRopRoot='1Kx9FZRhlj2grDbGSH8opHU3pQFemReyG';
  folders[originalRopRoot]={getId:()=>originalRopRoot,getParents:()=>parents([])};
  const manifest={schemaVersion:1,source:'SAHMT_V2_TRAINING_RELEASE',managerAreaId:area,actorUid:'admin',items:[]};
  for(const [rootId,group,count,kind] of roots)for(let index=0;index<count;index++) {
    const number=manifest.items.length,formId=`FormFixture${String(number).padStart(4,'0')}`,sourceId=`SourceFixture${String(number).padStart(4,'0')}`;
    const items=plain(ctx.formsEvaluationTemplateSpecs_()).map((spec,i)=>{
      const item={itemId:`aux-${i}`,title:spec.title,description:spec.description};
      if(spec.kind==='HEADER')item.textItem={};
      else item.questionItem={question:{questionId:`question-${i}`,required:spec.required===true,...(spec.kind==='PARAGRAPH'?{textQuestion:{paragraph:true}}:{choiceQuestion:{type:spec.kind,options:spec.options.map(value=>({value}))}})}};
      return item;
    });
    const scored=kind==='ROP'?22:10;
    for(let q=0;q<scored;q++)items.push({itemId:`test-${q}`,title:`Questão fictícia ${q}`,questionItem:{question:{questionId:`test-question-${q}`,choiceQuestion:{type:'RADIO',options:[{value:'A'},{value:'B'}]},grading:{pointValue:1,correctAnswers:{answers:[{value:'A'}]}}}}});
    const meta={formId,info:{title:`Avaliação fictícia ${number}`},responderUri:`https://docs.google.com/forms/d/e/AliasFixture${number}/viewform`,settings:{emailCollectionType:'VERIFIED',quizSettings:{isQuiz:true}},items};metadata.set(formId,meta);
    let accepting=false,published=false;
    const form={getId:()=>formId,hasLimitOneResponsePerUser:()=>true,canEditResponse:()=>false,supportsAdvancedResponderPermissions:()=>true,isAcceptingResponses:()=>accepting,isPublished:()=>published,
      permissions:[{id:'owner',type:'user',role:'owner',emailAddress:operator},{id:'public',type:'anyone',role:'reader',view:'published'}],
      setAcceptingResponses:value=>{if(value)assert.equal(inTransaction,false);formOperations.push({id:formId,kind:'accepting',value});accepting=value;return form;},
      setPublished:value=>{if(value)assert.equal(inTransaction,false);formOperations.push({id:formId,kind:'published',value});published=value;if(!value)accepting=false;return form;}};
    forms.set(formId,form);
    const ownerMetadata={id:sourceId,name:`Material fictício ${number}`,mimeType:kind==='ROP'?'application/vnd.google-apps.form':'application/pdf',trashed:false,parents:[kind==='ROP'?originalRopRoot:rootId],owners:[{emailAddress:operator,permissionId:'owner-id'}],capabilities:{canShare:true}};
    files.set(sourceId,{isTrashed:()=>false,getMimeType:()=>ownerMetadata.mimeType,getParents:()=>parents([folders[kind==='ROP'?originalRopRoot:rootId]]),ownerMetadata,permissions:[{id:'owner-id',type:'user',role:'owner',emailAddress:operator},{id:`reader-${number}`,type:'user',role:'reader',emailAddress:group==='GENERAL'?'general@example.invalid':'restricted@example.invalid'}]});
    const materialIds=kind==='DOCUMENT'?[sourceId]:[`MaterialFixture${String(number).padStart(4,'0')}`,...(index<8?[`MaterialExtraFixture${String(number).padStart(4,'0')}`]:[])];
    if(kind==='ROP')for(const materialId of materialIds)files.set(materialId,{ownerMetadata:{...copy(ownerMetadata),id:materialId,mimeType:'application/pdf',parents:[rootId]},permissions:[{id:'owner-id',type:'user',role:'owner',emailAddress:operator},{id:`reader-${materialId}`,type:'user',role:'reader',emailAddress:'general@example.invalid'}]});
    if(kind==='ROP')files.set(formId,{isTrashed:()=>false,getMimeType:()=> 'application/vnd.google-apps.form',getParents:()=>parents([folders[rootId]])});
    const item={formId,sourceId,rootId,title:meta.info.title,eligibleGroup:group,creditScopeId:`matter_${number}`,version:1,maxTestScore:scored,
      acknowledgementItemId:'aux-2',suggestionProblemItemId:'aux-4',suggestionProposalItemId:'aux-5',suggestionBenefitItemId:'aux-6',materialUrls:materialIds.map(id=>`https://drive.google.com/file/d/${id}/view`),validFrom:'2026-10-06',validUntil:'2026-12-31'};
    if(kind==='DOCUMENT'){item.expectedItems=copy(items);item.knownIds=Object.fromEntries(items.map(entry=>[entry.itemId,entry.questionItem?.question.questionId||null]));item.expectedItemsHash=ctx.trainingDocumentsHash_(items);}
    else item.preparedOriginalDigest=ctx.formsEvaluationHash_(ctx.ropsSecondSemesterComparable_(meta,false));
    manifest.items.push(item);
  }
  files.set(roots[3][0],{ownerMetadata:{id:roots[3][0],mimeType:'application/vnd.google-apps.folder',trashed:false,parents:['1AHqrb1elRlNSmw8L3t_z53gTOo6YjLU2'],inheritedPermissionsDisabled:true,owners:[{emailAddress:operator,permissionId:'owner-id'}],capabilities:{canShare:true,canDisableInheritedPermissions:true}},permissions:[{id:'owner-id',type:'user',role:'owner',emailAddress:operator}]});
  ctx.formsEvaluationMaterialSnapshot_ = urls => urls.map(url=>({fileId:url.split('/')[5],contentHash:'synthetic verified content',contentHashFormat:'stable',contentVerified:true}));
  properties.set('SAHMT_V2_EVALUATION_ALLOWED_EMAILS',operator);
  const profile=(uid,email,admin=false)=>({uid,email,active:true,access:true,role:'usuario',permissions:admin?{admin:true}:{}});
  seed('users','admin',profile('admin',operator,true));seed('users','manager',profile('manager','manager@example.invalid'));seed('users','general',profile('general','general@example.invalid'));seed('users','restricted',profile('restricted','restricted@example.invalid'));
  seed('managementAreas',area,{active:true});seed('evaluationAssignments',area,{areaId:area,uid:'manager',version:1});
  seed('documentAccessEmails','general@example.invalid',{email:'general@example.invalid',active:true,groups:['GENERAL']});seed('documentAccessEmails','restricted@example.invalid',{email:'restricted@example.invalid',active:true,groups:['RESTRICTED']});
  const manifestId='ManifestFixture0001';let raw;
  const manifestFile={isTrashed:()=>false,getOwner:()=>({getEmail:()=>operator}),getSharingAccess:()=>ctx.DriveApp.Access.PRIVATE,getEditors:()=>[],getViewers:()=>[],getBlob:()=>({getDataAsString:()=>raw}),
    ownerMetadata:{id:manifestId,trashed:false,shared:false,parents:['PrivateParentFixture'],owners:[{emailAddress:operator,permissionId:'owner-id'}]},permissions:[{id:'owner-id',type:'user',role:'owner',emailAddress:operator}]};files.set(manifestId,manifestFile);
  files.set('PrivateParentFixture',{ownerMetadata:{id:'PrivateParentFixture',trashed:false,shared:false,owners:[{emailAddress:operator,permissionId:'owner-id'}]},permissions:[{id:'owner-id',type:'user',role:'owner',emailAddress:operator}]});
  function seal() {raw=JSON.stringify(manifest);properties.set('SAHMT_V2_TRAINING_RELEASE_MANIFEST_ID',manifestId);properties.set('SAHMT_V2_TRAINING_RELEASE_MANIFEST_SHA256',hash(raw));}
  seal();
  return {ctx,manifest,manifestId,manifestFile,properties,store,forms,files,folders,metadata,commits,logs,checks,triggers,removedTriggers,mutations,readbacks,waves,formOperations,get,seed,seal,load:()=>ctx.trainingReleaseLoad_(),advance:milliseconds=>{time+=milliseconds;}};
}

test('defining release and read-only inspection write no catalog, Forms, credits or triggers',()=>{
  const h=fixture(),before=copy([...h.properties]);assert.equal(h.commits.length,0);
  const result=h.ctx.consultarCatalogoTreinamentosSahmtV2();assert.equal(result.status,'READ_ONLY');assert.equal(result.totalForms,76);assert.equal(result.preparedForms,0);
  assert.deepEqual([...h.properties],before);assert.equal(h.triggers.length,0);assert.ok(h.checks.every(value=>value===false));
});
test('manifest rejects arbitrary audience, group/root mismatch, count, shape and duplicate identities',()=>{
  const mutations=[m=>m.items[0].eligibleGroup='EVERYONE',m=>m.items[18].eligibleGroup='GENERAL',m=>m.items.pop(),m=>m.unexpected=true,m=>m.items[0].rootId='invented-root',m=>m.items[1].formId=m.items[0].formId,m=>m.items[1].sourceId=m.items[0].sourceId,m=>m.items[0].version=2,m=>m.items[0].creditScopeId='document:invalid',m=>m.items[0].materialUrls=['https://docs.google.com.evil.invalid/file'],m=>m.items[0].expectedItemsHash='invalid'];
  for(const mutate of mutations){const h=fixture();mutate(h.manifest);h.seal();const result=h.ctx.prepararCatalogoTreinamentosSahmtV2();assert.equal(result.status,'CONFIGURATION_PENDING');assert.equal(h.commits.length,0);assert.equal(h.triggers.length,0);}
});
test('manifest owner ACL and SHA256 are mandatory, including inherited and group grants',()=>{
  for(const mutate of [h=>h.manifestFile.getEditors=()=>[{}],h=>h.manifestFile.getOwner=()=>({getEmail:()=> 'other@example.invalid'}),h=>h.manifestFile.permissions.push({type:'group',role:'reader'}),h=>h.manifestFile.permissions[0].id='other-owner-id',h=>h.properties.set('SAHMT_V2_TRAINING_RELEASE_MANIFEST_SHA256','0'.repeat(64))]){
    const h=fixture();mutate(h);assert.equal(h.ctx.prepararCatalogoTreinamentosSahmtV2().status,'CONFIGURATION_PENDING');assert.equal(h.commits.length,0);
  }
});
test('inherited details of the exact owner require unshared owner-only file and parent ACL proof',()=>{
  const h=fixture();h.manifestFile.permissions[0].permissionDetails=[{inherited:true,role:'writer'},{inherited:false,role:'owner'}];assert.equal(h.load().manifest.items.length,76);
  for(const mutate of [f=>f.manifestFile.ownerMetadata.shared=true,f=>f.files.get('PrivateParentFixture').ownerMetadata.shared=true,f=>f.files.get('PrivateParentFixture').permissions.push({id:'other',type:'user',role:'reader',emailAddress:'other@example.invalid'}),f=>f.manifestFile.ownerMetadata.owners[0].permissionId='mismatched-id']){
    const f=fixture();f.manifestFile.permissions[0].permissionDetails=[{inherited:true,role:'writer'}];mutate(f);assert.equal(f.ctx.prepararCatalogoTreinamentosSahmtV2().status,'CONFIGURATION_PENDING');assert.equal(f.commits.length,0);
  }
});
test('active admin identity, existing assignment and active area are required without creating profiles or assignments',()=>{
  for(const mutate of [h=>h.seed('users','admin',{uid:'admin',email:operator,active:true,access:true,permissions:{}}),h=>h.seed('managementAreas',area,{active:false}),h=>h.store.delete(`evaluationAssignments/${area}`),h=>h.seed('users','duplicate',{uid:'duplicate',email:operator,active:true,access:true})]){
    const h=fixture(),before=copy([...h.store]);mutate(h);const expected=copy([...h.store]);assert.equal(h.ctx.prepararCatalogoTreinamentosSahmtV2().pendingCode,'ADMIN_AREA_ASSIGNMENT');assert.deepEqual([...h.store],expected);assert.ok(before.length>0);
  }
});
test('allowlisted operator and manifest administrator remain independent existing identities',()=>{
  const h=fixture();h.seed('users','admin',{uid:'admin',email:'independent-admin@example.invalid',active:true,access:true,permissions:{admin:true}});
  h.seed('users','manager',{uid:'manager',email:operator,active:true,access:true,permissions:{}});
  for(const file of h.files.values())if(file.ownerMetadata?.mimeType==='application/pdf')file.permissions.push({id:'admin-writer',type:'user',role:'writer',emailAddress:'independent-admin@example.invalid'});
  const beforeProfiles=copy([...h.store].filter(([key])=>key.startsWith('users/'))),loaded=h.load(),item=h.manifest.items[0];
  assert.equal(h.ctx.trainingReleasePrepared_(loaded,item).prepared,true);assert.equal(h.ctx.trainingReleaseReleased_(loaded,item).status,'READY');
  assert.equal(h.get('evaluationFormConfigs',item.formId).configuredByUid,'admin');assert.deepEqual([...h.store].filter(([key])=>key.startsWith('users/')),beforeProfiles);
});
test('metadata preparation batches five, confirms closed baseline, is idempotent, and preserves financial gates',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[0],propertiesBefore=copy([...h.properties].filter(([key])=>key.startsWith('SAHMT_V2_EVALUATION')));
  const result=h.ctx.prepararCatalogoTreinamentosSahmtV2();assert.equal(result.attemptedForms,5);assert.equal(result.preparedForms,5);assert.equal(result.publishedForms,0);
  assert.equal(h.get('evaluationActivities',item.formId).status,'CONFIGURATION_PENDING');assert.deepEqual(h.get('evaluationActivities',item.formId).eligibleUids,[]);
  assert.equal(h.get('evaluationActivities',item.formId).trainingReleaseClosedBaseline,true);const commits=h.commits.length;
  assert.equal(h.ctx.trainingReleasePrepared_(loaded,item).unchanged,true);assert.equal(h.commits.length,commits+1);assert.deepEqual(h.commits.at(-1),[]);
  assert.deepEqual([...h.properties].filter(([key])=>key.startsWith('SAHMT_V2_EVALUATION')),propertiesBefore);
  assert.ok(h.commits.flat().every(w=>w.collection==='evaluationActivities'));assert.equal(h.get('evaluationActivities',item.formId).expectedItems,undefined);
});
test('ambiguous source, unavailable source and open baseline stay pending while other items continue',()=>{
  const h=fixture();let parentIndex=0;
  h.files.get(h.manifest.items[0].sourceId).getParents=()=>{parentIndex=0;return {hasNext:()=>parentIndex<2,next:()=>h.folders[roots[parentIndex++][0]]};};
  h.files.delete(h.manifest.items[1].sourceId);h.forms.get(h.manifest.items[2].formId).setPublished(true);
  const result=h.ctx.prepararCatalogoTreinamentosSahmtV2();assert.equal(result.attemptedForms,5);assert.equal(result.pendingInBatch,3);assert.equal(result.preparedForms,2);
  assert.equal(h.forms.get(h.manifest.items[2].formId).isPublished(),false);assert.equal(h.get('evaluationActivities',h.manifest.items[0].formId),null);
  for(const log of h.logs)assert.doesNotMatch(log,/example\.invalid|FormFixture|https|gabarito|sensitive/);
});
test('document source evidence, live mappings and weights cannot change; ROP original count is preserved',()=>{
  for(const mutate of [h=>h.metadata.get(h.manifest.items[0].formId).items.at(-1).questionItem.question.grading.pointValue=2,h=>h.manifest.items[0].acknowledgementItemId='missing-item',h=>h.metadata.get(h.manifest.items[0].formId).items[4].title='altered auxiliary']){
    const h=fixture();mutate(h);h.seal();assert.equal(h.ctx.prepararCatalogoTreinamentosSahmtV2().pendingInBatch,1);
  }
  const h=fixture(),rop=h.manifest.items[45];assert.equal(rop.maxTestScore,22);assert.equal(h.ctx.trainingReleasePrepared_(h.load(),rop).prepared,true);
  h.metadata.get(rop.formId).items.at(-1).title='mutated original question';assert.throws(()=>h.ctx.trainingReleasePrepared_(h.load(),rop),/ROP_ORIGINAL_DIGEST/);
});
test('configuration dispatch and finalizer publish exact group outside transactions with scoring disabled',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[18];h.ctx.trainingReleasePrepared_(loaded,item);
  const result=h.ctx.trainingReleaseReleased_(loaded,item);assert.equal(result.status,'READY');assert.equal(result.productionFinancialWrites,false);
  const cfg=h.get('evaluationFormConfigs',item.formId);assert.equal(cfg.configuredByUid,'admin');assert.deepEqual(cfg.eligibleUids,[]);assert.deepEqual(cfg.eligibleGroups,['RESTRICTED']);
  assert.deepEqual(h.forms.get(item.formId).permissions.filter(p=>p.view==='published').map(p=>p.emailAddress),['restricted@example.invalid']);
  const configVersion=cfg.configVersion;assert.equal(h.ctx.trainingReleaseReleased_(loaded,item).status,'READY');assert.equal(h.get('evaluationFormConfigs',item.formId).configVersion,configVersion);
  assert.ok(h.commits.flat().every(w=>['evaluationActivities','evaluationRequests','evaluationFormConfigs','scopedDocuments'].includes(w.collection)));assert.ok(h.checks.every(check=>check===false));
  assert.throws(()=>h.ctx.evaluationAssertOperator_(true),/Ativação bloqueada/);assert.equal(h.get('evaluationRuntime','state'),null);
});
test('ACL failure and audience expansion stay closed and pending; stale version never configures',()=>{
  for(const mutate of [h=>h.forms.get(h.manifest.items[0].formId).failAdd=true,h=>h.store.delete('documentAccessEmails/general@example.invalid')]){
    const h=fixture(),loaded=h.load(),item=h.manifest.items[0];h.ctx.trainingReleasePrepared_(loaded,item);mutate(h);const result=h.ctx.liberarCatalogoTreinamentosSahmtV2();assert.equal(result.status,'CONFIGURATION_PENDING');assert.equal(h.forms.get(item.formId).isPublished(),false);
  }
  const h=fixture(),loaded=h.load(),item=h.manifest.items[0];h.seed('evaluationFormConfigs',item.formId,{formId:item.formId,creditScopeId:item.creditScopeId,version:2,configVersion:1});assert.throws(()=>h.ctx.trainingReleasePrepared_(loaded,item),/EXISTING_IDENTITY_CONFLICT/);
});
test('changed prepared content or material blocks generic publication until complete catalog verification repairs it',()=>{
  for(const change of ['content','material']){
    const h=fixture(),loaded=h.load(),item=h.manifest.items[0];h.ctx.trainingReleasePrepared_(loaded,item);h.ctx.trainingReleaseReleased_(loaded,item);
    const meta=h.metadata.get(item.formId),snapshot=h.ctx.formsEvaluationMaterialSnapshot_;
    if(change==='content')meta.items[1].description='Changed support instructions';
    else h.ctx.formsEvaluationMaterialSnapshot_=urls=>snapshot(urls).map(value=>({...value,contentHash:'changed PDF bytes'}));
    assert.equal(h.ctx.formsEvaluationFinalizePublication_(item.formId).status,'CONFIGURATION_PENDING');
    assert.equal(h.get('evaluationActivities',item.formId).trainingReleaseBlocked,true);assert.equal(h.get('evaluationFormConfigs',item.formId).publicationPending,false);
    assert.equal(h.forms.get(item.formId).isPublished(),false);assert.equal(h.forms.get(item.formId).isAcceptingResponses(),false);
    if(change==='content')meta.items[1].description=item.expectedItems[1].description;else h.ctx.formsEvaluationMaterialSnapshot_=snapshot;
    assert.equal(h.ctx.formsEvaluationFinalizePublication_(item.formId).status,'CONFIGURATION_PENDING');assert.equal(h.forms.get(item.formId).isPublished(),false);
    assert.equal(h.ctx.trainingReleaseReleased_(loaded,item).status,'READY');assert.equal(h.get('evaluationFormConfigs',item.formId).trainingReleaseBlocked,false);
  }
});
test('canonical credit scope aliases remain separate Forms and groups without granting individual UIDs',()=>{
  const h=fixture();h.manifest.items[18].creditScopeId=h.manifest.items[0].creditScopeId;h.seal();assert.equal(h.load().manifest.items.length,76);
  const loaded=h.load();for(const item of [h.manifest.items[0],h.manifest.items[18]])assert.equal(h.ctx.trainingReleasePrepared_(loaded,item).prepared,true);
  assert.deepEqual(h.get('evaluationActivities',h.manifest.items[0].formId).eligibleGroups,['GENERAL']);assert.deepEqual(h.get('evaluationActivities',h.manifest.items[18].formId).eligibleGroups,['RESTRICTED']);
});
test('delayed first configuration starts today without importing the preceding days',()=>{
  const h=fixture();h.advance(86400000);const loaded=h.load(),item=h.manifest.items[0];h.ctx.trainingReleasePrepared_(loaded,item);assert.equal(h.ctx.trainingReleaseReleased_(loaded,item).status,'READY');
  const cfg=h.get('evaluationFormConfigs',item.formId);assert.equal(new Date(cfg.validFrom).toISOString(),'2026-10-07T03:00:00.000Z');assert.equal(new Date(cfg.firstEligibleAt).toISOString(),'2026-10-07T15:00:00.000Z');
});
test('one editor function creates only its bounded temporary job and cancels on critical manifest change',()=>{
  const h=fixture();const result=h.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();assert.equal(result.status,'RUNNING');assert.equal(result.attemptedForms,76);assert.equal(result.publishedForms,0);assert.equal(result.phase,'MATERIALS');assert.equal(h.triggers.length,1);
  const triggerId=h.triggers[0].getUniqueId();const before=copy([...h.properties]);assert.equal(h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2().runs,1);assert.deepEqual([...h.properties],before);
  h.manifestFile.permissions.push({type:'group',role:'reader'});assert.equal(h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_().status,'CONFIGURATION_PENDING');assert.deepEqual(h.removedTriggers,[triggerId]);assert.equal(h.triggers.length,0);
});
test('temporary job finishes 76 forms, preserves unrelated triggers, and expires without writes',()=>{
  const h=fixture();const unrelated={getUniqueId:()=> 'unrelated',getHandlerFunction:()=> 'anotherHandler'};h.triggers.push(unrelated);
  h.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();let result;
  for(let run=1;run<80;run++){result=h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_();if(result.status!=='RUNNING')break;}
  assert.equal(result.status,'COMPLETED');assert.equal(result.publishedForms,76);assert.equal(result.managementDocuments,76);assert.equal(result.validatedForms,76);assert.equal(result.liveFormsRevalidated,true);
  assert.deepEqual(h.triggers,[unrelated]);assert.equal(h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_().status,'COMPLETED');
  assert.equal(h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2().liveFormsRevalidated,false);
  const restarted=h.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();assert.equal(restarted.status,'RUNNING');assert.equal(restarted.publishedForms,0);assert.equal(restarted.validatedForms,0);assert.equal(restarted.liveFormsRevalidated,false);
  const expired=fixture();expired.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();expired.advance(86400000);const writes=expired.commits.length;
  assert.equal(expired.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_().pendingCode,'JOB_LIMIT');assert.equal(expired.commits.length,writes);assert.equal(expired.triggers.length,0);
});
test('time budget stops scheduling further Forms and checkpoints preserve the next index',()=>{
  const h=fixture(),prepare=h.ctx.trainingReleasePrepared_;h.ctx.trainingReleasePrepared_=(loaded,item)=>{const result=prepare(loaded,item);h.advance(80000);return result;};
  const result=h.ctx.prepararCatalogoTreinamentosSahmtV2();assert.equal(result.attemptedForms,2);assert.equal(result.preparedForms,2);
  assert.equal(JSON.parse(h.properties.get('SAHMT_V2_TRAINING_RELEASE_CURSOR')).prepare,2);
});

const jobProperty='SAHMT_V2_TRAINING_RELEASE_JOB',cursorProperty='SAHMT_V2_TRAINING_RELEASE_CURSOR';
const releaseHandler='continuarDisponibilizacaoTreinamentosSahmtV2_';
function stoppedReleaseJob(h, changes={}) {
  const loaded=h.load(),audience=h.ctx.trainingReleaseMaterialAudience_(loaded);
  const job={schemaVersion:2,status:'CONFIGURATION_PENDING',pendingCode:'JOB_ACCESS',digest:loaded.digest,
    startedAt:Date.parse('2026-10-06T15:00:00Z'),runs:19,phase:'FORMS',closeCursor:0,closeMask:'1'.repeat(76),
    materialCursor:0,materialMask:'1'.repeat(84),materialAudienceDigest:audience.digest,verifiedMask:'1'.repeat(16)+'0'.repeat(60),
    triggerId:'stopped-trigger',preparedForms:19,publishedForms:17,pendingForms:59,validatedForms:16,materialPrepared:84,materialPending:0,
    productionFinancialWrites:false,...changes};
  h.properties.set(jobProperty,JSON.stringify(job));
  h.properties.set(cursorProperty,JSON.stringify({schemaVersion:1,digest:loaded.digest,prepare:0,release:0,combined:19}));
  return job;
}
function clockTrigger(id,handler=releaseHandler) {
  return {getUniqueId:()=>id,getHandlerFunction:()=>handler,getTriggerSource:()=> 'CLOCK',getEventType:()=> 'CLOCK'};
}
function assertNoReleaseMutation(h,before) {
  assert.deepEqual([...h.properties],before);assert.equal(h.commits.length,0);assert.equal(h.mutations.length,0);assert.equal(h.formOperations.length,0);
}

test('release checkpoint remains readable during catalog quota without exposing private job fields',()=>{
  const h=fixture(),job=stoppedReleaseJob(h,{status:'RUNNING',pendingCode:undefined,pendingItems:[{formId:'PrivateFormSentinel',pendingCode:'PRIVATE_SENTINEL'}],privateData:'PrivateJobSentinel'});
  h.triggers.push(clockTrigger(job.triggerId));
  h.ctx.trainingReleaseContext_=()=>{throw Object.assign(Error('PrivateProviderSentinel'),{status:429});};
  const before=copy([...h.properties]),triggers=[...h.triggers],result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
  assert.equal(result.status,'RUNNING');assert.equal(result.runs,19);assert.equal(result.phase,'FORMS');
  assert.equal(result.checkpointReadOnly,true);assert.equal(result.catalogReadAvailable,false);assert.equal(result.liveFormsRevalidated,false);
  assert.equal(result.catalogReadCode,'JOB_QUOTA_EXCEEDED');assert.equal(result.catalogHttpStatus,429);
  assert.equal(Object.hasOwn(result,'pendingCode'),false);assert.equal(Object.hasOwn(result,'httpStatus'),false);
  assert.equal(result.triggerLookupAvailable,true);assert.equal(result.triggerPresent,true);assert.equal(result.jobLimitReached,false);
  assert.equal(result.expiresAt,'2026-10-07T15:00:00.000Z');assert.equal(result.validatedForms,16);
  const output=JSON.stringify(result)+h.logs.join('');
  for(const privateValue of [job.digest,job.closeMask,job.materialMask,'PrivateFormSentinel','PRIVATE_SENTINEL','PrivateJobSentinel','PrivateProviderSentinel',operator])assert.equal(output.includes(privateValue),false);
  const logged=JSON.parse(h.logs.at(-1));
  assert.equal(logged.catalogReadCode,'JOB_QUOTA_EXCEEDED');assert.equal(logged.expiresAt,result.expiresAt);assert.equal(logged.triggerPresent,true);
  assertNoReleaseMutation(h,before);assert.deepEqual(h.triggers,triggers);assert.equal(h.removedTriggers.length,0);
});

test('catalog authorization failure does not overwrite the stored quota interruption',()=>{
  const h=fixture();stoppedReleaseJob(h,{pendingCode:'JOB_QUOTA_EXCEEDED',httpStatus:429});
  h.ctx.trainingReleaseContext_=()=>{throw Object.assign(Error('PrivateAuthorizationSentinel'),{status:403});};
  const before=copy([...h.properties]),result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
  assert.equal(result.status,'CONFIGURATION_PENDING');assert.equal(result.pendingCode,'JOB_QUOTA_EXCEEDED');assert.equal(result.httpStatus,429);
  assert.equal(result.catalogReadCode,'JOB_AUTHORIZATION_REQUIRED');assert.equal(result.catalogHttpStatus,403);
  assert.equal(result.triggerLookupAvailable,true);assert.equal(result.triggerPresent,false);assert.equal(result.jobLimitReached,false);
  assert.equal(JSON.stringify(result).includes('PrivateAuthorizationSentinel'),false);assertNoReleaseMutation(h,before);assert.equal(h.removedTriggers.length,0);
});

test('successful checkpoint query retains actual catalog counts and performs no mutation',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[0];
  h.ctx.trainingReleasePrepared_(loaded,item);h.ctx.trainingReleaseReleased_(loaded,item);
  const job=stoppedReleaseJob(h,{status:'RUNNING',pendingCode:undefined});h.triggers.push(clockTrigger(job.triggerId));
  h.commits.length=0;h.mutations.length=0;h.formOperations.length=0;
  const before=copy([...h.properties]),result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
  assert.equal(result.status,'RUNNING');assert.equal(result.catalogReadAvailable,true);assert.equal(result.checkpointReadOnly,true);
  assert.equal(result.totalForms,76);assert.equal(result.preparedForms,1);assert.equal(result.publishedForms,1);assert.equal(result.managementDocuments,1);
  assert.equal(result.generalForms,62);assert.equal(result.restrictedForms,14);assert.equal(result.liveFormsRevalidated,false);
  assert.equal(Object.hasOwn(result,'catalogReadCode'),false);assertNoReleaseMutation(h,before);assert.equal(h.triggers.length,1);
});

test('checkpoint query reports the original time and round limits without changing them',()=>{
  for(const boundary of ['age','runs']){
    const h=fixture(),job=stoppedReleaseJob(h,{runs:boundary==='runs'?80:19});if(boundary==='age')h.advance(86400000);
    h.ctx.trainingReleaseContext_=()=>{throw Object.assign(Error('PrivateQuotaSentinel'),{status:429});};
    const before=copy([...h.properties]),result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
    assert.equal(result.jobLimitReached,true);assert.equal(result.runs,job.runs);assert.equal(result.expiresAt,'2026-10-07T15:00:00.000Z');
    assert.equal(result.pendingCode,'JOB_ACCESS');assert.equal(result.catalogReadCode,'JOB_QUOTA_EXCEEDED');assertNoReleaseMutation(h,before);
  }
});

test('checkpoint query does not claim trigger absence when trigger lookup fails',()=>{
  const h=fixture();stoppedReleaseJob(h,{status:'RUNNING',pendingCode:undefined});
  h.ctx.ScriptApp.getProjectTriggers=()=>{throw Error('PrivateTriggerSentinel');};
  h.ctx.trainingReleaseContext_=()=>{throw Object.assign(Error('PrivateQuotaSentinel'),{status:429});};
  const before=copy([...h.properties]),result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
  assert.equal(result.triggerLookupAvailable,false);assert.equal(Object.hasOwn(result,'triggerPresent'),false);assert.equal(result.status,'RUNNING');
  assert.equal(JSON.stringify(result).includes('PrivateTriggerSentinel'),false);assertNoReleaseMutation(h,before);
});

test('invalid checkpoints fail closed before catalog or trigger lookup',()=>{
  for(const invalid of ['null','false','0','[]','"private-string"','not-json',null]){
    const h=fixture(),job=stoppedReleaseJob(h);
    h.properties.set(jobProperty,invalid===null?JSON.stringify({...job,startedAt:Date.parse('2026-10-06T15:00:01Z')}):invalid);
    h.ctx.trainingReleaseContext_=()=>{throw Error('Catalog must not be read');};
    h.ctx.ScriptApp.getProjectTriggers=()=>{throw Error('Triggers must not be read');};
    const before=copy([...h.properties]),result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
    assert.equal(result.status,'CONFIGURATION_PENDING');assert.equal(result.pendingCode,'CHECKPOINT_INVALID');
    assert.equal(Object.hasOwn(result,'runs'),false);assert.equal(Object.hasOwn(result,'expiresAt'),false);assert.equal(result.catalogReadAvailable,false);
    assertNoReleaseMutation(h,before);
  }
});

test('operator denial prevents reading or exposing a private checkpoint',()=>{
  const h=fixture();stoppedReleaseJob(h);h.properties.set('SAHMT_V2_EVALUATION_ALLOWED_EMAILS','denied@example.invalid');
  const getProperties=h.ctx.PropertiesService.getScriptProperties,reads=[];
  h.ctx.PropertiesService.getScriptProperties=()=>{const properties=getProperties();return {...properties,getProperty:key=>{reads.push(key);return properties.getProperty(key);}};};
  h.ctx.trainingReleaseLoad_=()=>{throw Error('Catalog must not be read');};
  const before=copy([...h.properties]),result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
  assert.equal(result.pendingCode,'JOB_AUTHORIZATION_REQUIRED');assert.equal(result.catalogReadAvailable,false);assert.equal(reads.includes(jobProperty),false);
  assert.equal(Object.hasOwn(result,'runs'),false);assert.equal(Object.hasOwn(result,'expiresAt'),false);assertNoReleaseMutation(h,before);
});

test('checkpoint query does not mix catalog counts from another manifest',()=>{
  const h=fixture();stoppedReleaseJob(h);const load=h.ctx.trainingReleaseLoad_;
  h.ctx.trainingReleaseLoad_=()=>({...load(),digest:'f'.repeat(64)});
  const before=copy([...h.properties]),result=h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2();
  assert.equal(result.catalogReadCode,'JOB_MANIFEST_CONFLICT');assert.equal(result.catalogReadAvailable,false);
  assert.equal(Object.hasOwn(result,'publishedForms'),false);assert.equal(result.runs,19);assertNoReleaseMutation(h,before);
});

test('quota interruption is classified and resumed at the same checkpoint without extending the job',()=>{
  const h=fixture(),initial=stoppedReleaseJob(h,{status:'RUNNING'}),cursor=h.properties.get(cursorProperty),audience=h.ctx.trainingReleaseMaterialAudience_;
  h.triggers.push(clockTrigger(initial.triggerId));
  h.ctx.trainingReleaseMaterialAudience_=()=>{throw Object.assign(Error('sensitive private provider body'),{status:429});};
  const interrupted=h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_();
  assert.equal(interrupted.pendingCode,'JOB_QUOTA_EXCEEDED');assert.equal(interrupted.httpStatus,429);assert.equal(h.triggers.length,0);
  const stopped=JSON.parse(h.properties.get(jobProperty));assert.equal(stopped.runs,20);assert.equal(stopped.startedAt,initial.startedAt);
  h.ctx.trainingReleaseMaterialAudience_=audience;h.advance(3600000);
  const resumed=h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2(),after=JSON.parse(h.properties.get(jobProperty));
  assert.equal(resumed.status,'RUNNING');assert.equal(resumed.resumedOriginalJob,true);assert.equal(h.triggers.length,1);
  const expected={...stopped,status:'RUNNING',triggerId:h.triggers[0].getUniqueId()};delete expected.pendingCode;delete expected.httpStatus;
  assert.deepEqual(after,expected);assert.equal(h.properties.get(cursorProperty),cursor);assert.equal(after.runs,20);assert.equal(after.startedAt,initial.startedAt);
  assert.equal(h.commits.length,0);assert.equal(h.mutations.length,0);assert.equal(h.formOperations.length,0);
  assert.equal(h.logs.some(log=>log.includes('sensitive private provider body')),false);
  h.advance(86400000-3600000);const writes=h.commits.length;
  assert.equal(h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_().pendingCode,'JOB_LIMIT');assert.equal(h.commits.length,writes);assert.equal(h.triggers.length,0);
});

test('historic JOB_ACCESS and explicit transient HTTP failures can resume without changing counters or masks',()=>{
  for(const [status,code] of [[null,'JOB_ACCESS'],[429,'JOB_QUOTA_EXCEEDED'],[503,'JOB_TEMPORARY_SERVICE'],[409,'JOB_REVISION_CONFLICT']]) {
    const h=fixture(),initial=stoppedReleaseJob(h,{pendingCode:code,...(status?{httpStatus:status}:{})}),cursor=h.properties.get(cursorProperty);
    const result=h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2(),job=JSON.parse(h.properties.get(jobProperty));
    assert.equal(result.status,'RUNNING');assert.equal(job.runs,initial.runs);assert.equal(job.startedAt,initial.startedAt);
    for(const key of ['digest','phase','closeCursor','closeMask','materialCursor','materialMask','materialAudienceDigest','verifiedMask'])assert.equal(job[key],initial[key]);
    assert.equal(h.properties.get(cursorProperty),cursor);assert.equal(h.triggers.length,1);assert.equal(h.commits.length,0);assert.equal(h.mutations.length,0);
  }
});

test('running jobs reuse their exact clock trigger and public resume never runs a batch inside its lock',()=>{
  const h=fixture(),job=stoppedReleaseJob(h,{status:'RUNNING'}),known=clockTrigger(job.triggerId),unrelated=clockTrigger('unrelated','otherHandler');
  h.triggers.push(known,unrelated);let held=false,releases=0;
  h.ctx.LockService.getScriptLock=()=>({tryLock:()=>{assert.equal(held,false);held=true;return true;},releaseLock:()=>{held=false;releases++;}});
  h.ctx.trainingReleaseBatch_=()=>{throw Error('resume must not execute any batch');};
  const before=copy([...h.properties]);
  assert.equal(h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2().status,'RUNNING');
  assert.equal(h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2().status,'RUNNING');
  assert.deepEqual(h.triggers,[known,unrelated]);assert.equal(h.removedTriggers.length,0);assert.equal(releases,2);assert.equal(held,false);assertNoReleaseMutation(h,before);
});

test('resume rejects changed identity, audience, invalid checkpoints and exhausted limits with no changes',()=>{
  const variants=[
    h=>h.seed('users','admin',{uid:'admin',email:operator,active:true,access:true,permissions:{}}),
    h=>h.manifestFile.permissions.push({type:'group',role:'reader'}),
    h=>h.seed('documentAccessEmails','other@example.invalid',{email:'other@example.invalid',active:true,groups:['GENERAL']}),
    h=>h.advance(86400000),
    (h,job)=>job.runs=80,
    (h,job)=>job.runs=-1,
    (h,job)=>job.startedAt+=1000,
    (h,job)=>job.digest='0'.repeat(64),
    (h,job)=>job.schemaVersion=1,
    (h,job)=>job.closeMask='0'+'1'.repeat(75),
    (h,job)=>job.materialMask='0'+'1'.repeat(83),
    (h,job)=>job.verifiedMask='invalid',
    (h,job)=>job.materialCursor=84,
    (h,job)=>job.productionFinancialWrites=true,
    (h,job)=>job.pendingCode='JOB_LIMIT',
    (h,job)=>job.pendingCode='ADMIN_AREA_ASSIGNMENT',
    (h,job)=>{job.pendingCode='JOB_ACCESS';job.httpStatus=403;},
    h=>{const cursor=JSON.parse(h.properties.get(cursorProperty));cursor.combined=76;h.properties.set(cursorProperty,JSON.stringify(cursor));},
    h=>h.properties.delete(cursorProperty)
  ];
  for(const alter of variants) {
    const h=fixture(),job=stoppedReleaseJob(h);alter(h,job);h.properties.set(jobProperty,JSON.stringify(job));
    const before=copy([...h.properties]);assert.equal(h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2().status,'CONFIGURATION_PENDING');
    assert.equal(h.triggers.length,0);assert.equal(h.removedTriggers.length,0);assertNoReleaseMutation(h,before);
  }
  const expiresDuringValidation=fixture();stoppedReleaseJob(expiresDuringValidation);const audience=expiresDuringValidation.ctx.trainingReleaseMaterialAudience_;
  expiresDuringValidation.ctx.trainingReleaseMaterialAudience_=(...args)=>{const value=audience(...args);expiresDuringValidation.advance(86400000);return value;};
  const before=copy([...expiresDuringValidation.properties]);
  assert.equal(expiresDuringValidation.ctx.retomarDisponibilizacaoTreinamentosSahmtV2().pendingCode,'JOB_LIMIT');
  assert.equal(expiresDuringValidation.triggers.length,0);assertNoReleaseMutation(expiresDuringValidation,before);
});

test('resume rejects unknown, duplicate or non-clock handler triggers without removing them',()=>{
  for(const makeTriggers of [
    job=>[clockTrigger('unknown')],
    job=>[clockTrigger(job.triggerId),clockTrigger(job.triggerId)],
    job=>[clockTrigger(job.triggerId,'wrongHandler')],
    job=>[{...clockTrigger(job.triggerId),getTriggerSource:()=> 'SPREADSHEETS'}],
    job=>[{...clockTrigger(job.triggerId),getEventType:()=> 'ON_EDIT'}]
  ]) {
    const h=fixture(),job=stoppedReleaseJob(h);h.triggers.push(...makeTriggers(job));const before=copy([...h.properties]),triggers=[...h.triggers];
    const result=h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2();assert.equal(result.pendingCode,'JOB_TRIGGER_CONFLICT');
    assert.deepEqual(h.triggers,triggers);assert.equal(h.removedTriggers.length,0);assertNoReleaseMutation(h,before);
  }
});

test('resume notices property drift before arming and compensates only its newly created trigger',()=>{
  const early=fixture();stoppedReleaseJob(early);const audience=early.ctx.trainingReleaseMaterialAudience_,originalJob=early.properties.get(jobProperty);
  early.ctx.trainingReleaseMaterialAudience_=(...args)=>{const value=audience(...args);early.properties.set(cursorProperty,'manual concurrent cursor');return value;};
  assert.equal(early.ctx.retomarDisponibilizacaoTreinamentosSahmtV2().pendingCode,'JOB_CHANGED_DURING_RESUME');
  assert.equal(early.properties.get(jobProperty),originalJob);assert.equal(early.properties.get(cursorProperty),'manual concurrent cursor');assert.equal(early.triggers.length,0);
  const h=fixture();stoppedReleaseJob(h);const unrelated=clockTrigger('unrelated','otherHandler');h.triggers.push(unrelated);
  const nativeCreate=h.ctx.ScriptApp.newTrigger;let manualRaw;
  h.ctx.ScriptApp.newTrigger=handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{
    const created=nativeCreate(handler).timeBased().everyMinutes(minutes).create();
    manualRaw=JSON.stringify({...JSON.parse(h.properties.get(jobProperty)),status:'MANUAL_REVIEW',runs:21});h.properties.set(jobProperty,manualRaw);return created;
  }})})});
  assert.equal(h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2().pendingCode,'JOB_CHANGED_DURING_RESUME');
  assert.equal(h.properties.get(jobProperty),manualRaw);assert.deepEqual(h.triggers,[unrelated]);assert.equal(h.removedTriggers.length,1);
  assert.equal(h.commits.length,0);assert.equal(h.mutations.length,0);assert.equal(h.formOperations.length,0);
});

test('unknown trigger creation outcome leaves a guarded intent and is never blindly armed twice',()=>{
  const h=fixture();stoppedReleaseJob(h);const create=h.ctx.ScriptApp.newTrigger,cursor=h.properties.get(cursorProperty);
  h.ctx.ScriptApp.newTrigger=handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{
    create(handler).timeBased().everyMinutes(minutes).create();throw Object.assign(Error('private transient transport body'),{status:503});
  }})})});
  const first=h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2();assert.equal(first.pendingCode,'JOB_TEMPORARY_SERVICE');assert.equal(first.httpStatus,503);
  assert.equal(JSON.parse(h.properties.get(jobProperty)).pendingCode,'JOB_TRIGGER_UNCONFIRMED');assert.equal(h.triggers.length,1);
  const before=copy([...h.properties]);assert.equal(h.ctx.retomarDisponibilizacaoTreinamentosSahmtV2().pendingCode,'JOB_RESUME_REQUIRES_REVIEW');
  assert.equal(h.triggers.length,1);assert.equal(h.removedTriggers.length,0);assert.equal(h.properties.get(cursorProperty),cursor);assertNoReleaseMutation(h,before);
  assert.equal(h.logs.some(log=>log.includes('private transient transport body')),false);
});





function materialJob(h) {
  return {schemaVersion:2,status:'RUNNING',digest:h.load().digest,phase:'MATERIALS',closeCursor:0,closeMask:'1'.repeat(76),materialCursor:0,materialMask:'0'.repeat(84),materialAudienceDigest:'',verifiedMask:'0'.repeat(76),runs:16,startedAt:Date.parse('2026-10-06T15:00:00Z'),productionFinancialWrites:false};
}
const materialId = item => item.materialUrls[0].match(/\/d\/([^/]+)/)[1];
function finishJob(h, result=h.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2()) {
  for(let run=1;run<80&&result.status==='RUNNING';run++)result=h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_();
  return result;
}

test('material catalog is exactly 84 distinct approved files: 70 GENERAL and 14 RESTRICTED',()=>{
  const h=fixture(),loaded=h.load(),catalog=plain(h.ctx.trainingReleaseMaterialCatalog_(loaded));
  assert.equal(catalog.length,84);assert.equal(new Set(catalog.map(entry=>entry.id)).size,84);
  assert.equal(catalog.filter(entry=>entry.group==='GENERAL').length,70);assert.equal(catalog.filter(entry=>entry.group==='RESTRICTED').length,14);
  for(const item of h.manifest.items.slice(45))assert.ok(item.materialUrls.every(url=>!url.includes(item.sourceId)&&!url.includes(item.formId)));
  assert.equal(h.manifest.items.slice(45).filter(item=>item.materialUrls.length===2).length,8);
  const beforeProperties=copy([...h.properties]),beforeStore=copy([...h.store]);
  const result=h.ctx.consultarAcessoMateriaisTreinamentosSahmtV2();assert.equal(result.status,'READ_ONLY');assert.equal(result.materialPrepared,84);assert.equal(result.liveMaterialsRevalidated,true);
  assert.deepEqual([...h.properties],beforeProperties);assert.deepEqual([...h.store],beforeStore);assert.equal(h.mutations.length,0);assert.equal(h.formOperations.length,0);
});

test('material reference conflicts, Forms, JSON and unknown owners remain unverified',()=>{
  const conflict=fixture();conflict.manifest.items[18].materialUrls.push(conflict.manifest.items[0].materialUrls[0]);conflict.seal();
  assert.throws(()=>conflict.ctx.trainingReleaseMaterialCatalog_(conflict.load()),/MATERIAL_GROUP_CONFLICT/);assert.equal(conflict.mutations.length,0);
  for(const mutate of [
    (h,item)=>{item.materialUrls[0]=`https://drive.google.com/file/d/${item.sourceId}/view`;h.seal();},
    (h,item)=>h.files.get(materialId(item)).ownerMetadata.mimeType='application/json',
    (h,item)=>h.files.get(materialId(item)).ownerMetadata.owners[0].emailAddress='unknown-owner@example.invalid'
  ]){
    const h=fixture(),item=h.manifest.items[45];mutate(h,item);
    assert.equal(h.ctx.consultarAcessoMateriaisTreinamentosSahmtV2().status,'CONFIGURATION_PENDING');
    assert.equal(h.mutations.length,0);assert.equal(h.forms.get(item.formId).isPublished(),false);
  }
});

test('unknown material editors are never removed or converted and cannot produce a ready checkpoint',()=>{
  const h=fixture(),loaded=h.load(),job=materialJob(h),entry=h.ctx.trainingReleaseMaterialCatalog_(loaded)[0],file=h.files.get(entry.id);
  file.permissions.push({id:'unknown-editor',type:'user',role:'writer',emailAddress:'unknown-editor@example.invalid'});
  const before=copy(file.permissions),result=h.ctx.trainingReleaseMaterialBatch_(loaded,job);
  assert.ok(result.pendingItems.some(item=>item.materialId===entry.id&&item.pendingCode==='MATERIAL_EDITOR_UNKNOWN'));
  assert.equal(job.materialMask[0],'0');assert.equal(result.materialPrepared,83);assert.equal(job.phase,'MATERIALS');assert.deepEqual(file.permissions,before);
  assert.equal(h.mutations.filter(mutation=>mutation.id===entry.id).length,0);assert.equal([...h.forms.values()].some(form=>form.isPublished()),false);
});

test('material ACL mutations use distinct files in sequential waves and read exact permissions back',()=>{
  const h=fixture(),loaded=h.load(),job=materialJob(h),catalog=plain(h.ctx.trainingReleaseMaterialCatalog_(loaded));
  for(const entry of catalog)h.files.get(entry.id).permissions=[{id:'owner-id',type:'user',role:'owner',emailAddress:operator},{id:`public-${entry.id}`,type:'anyone',role:'reader'}];
  const result=h.ctx.trainingReleaseMaterialBatch_(loaded,job);assert.equal(result.attemptedMaterials,84);
  assert.equal(job.materialMask,'1'.repeat(84));assert.equal(job.phase,'FORMS');assert.equal(h.waves.length,2);
  const materialIds=new Set(catalog.map(entry=>entry.id));assert.ok(h.mutations.every(mutation=>materialIds.has(mutation.id)));
  for(const entry of catalog){
    assert.deepEqual(h.mutations.filter(mutation=>mutation.id===entry.id).map(mutation=>mutation.method),['delete','post']);
    assert.ok(h.readbacks.filter(read=>read.id===entry.id&&read.kind==='permissions').length>=2);
    assert.deepEqual(h.files.get(entry.id).permissions.filter(permission=>permission.role==='reader').map(permission=>permission.emailAddress),[entry.group==='GENERAL'?'general@example.invalid':'restricted@example.invalid']);
  }
  assert.equal([...h.forms.values()].some(form=>form.isPublished()),false);assert.equal(h.commits.length,0);
});

test('material timeout retains its cursor and retry reads successful mutations without replaying grants',()=>{
  const h=fixture(),loaded=h.load(),job=materialJob(h),catalog=plain(h.ctx.trainingReleaseMaterialCatalog_(loaded));
  for(const entry of catalog)h.files.get(entry.id).permissions=[{id:'owner-id',type:'user',role:'owner',emailAddress:operator},{id:`public-${entry.id}`,type:'anyone',role:'reader'}];
  const nativeWave=h.ctx.UrlFetchApp.fetchAll;let waves=0;h.ctx.UrlFetchApp.fetchAll=requests=>{const result=nativeWave(requests);if(++waves===1)h.advance(170000);return result;};
  const first=h.ctx.trainingReleaseMaterialBatch_(loaded,job);assert.equal(first.attemptedMaterials,84);assert.equal(job.materialCursor,0);assert.equal(job.materialMask,'0'.repeat(84));
  assert.deepEqual(h.mutations.map(mutation=>mutation.method),Array(84).fill('delete'));
  h.ctx.UrlFetchApp.fetchAll=nativeWave;const resumed=h.ctx.trainingReleaseMaterialBatch_(loaded,job);assert.equal(resumed.materialPrepared,84);assert.equal(job.materialCursor,0);
  for(const entry of catalog)assert.deepEqual(h.mutations.filter(mutation=>mutation.id===entry.id).map(mutation=>mutation.method),['delete','post']);
});

test('Drive 403 leaves material pending, Form closed and no fake READY metadata',()=>{
  const h=fixture(),loaded=h.load(),job=materialJob(h),entry=h.ctx.trainingReleaseMaterialCatalog_(loaded)[0],file=h.files.get(entry.id);
  file.permissions=[{id:'owner-id',type:'user',role:'owner',emailAddress:operator}];file.failAdd=true;
  const result=h.ctx.trainingReleaseMaterialBatch_(loaded,job);assert.ok(result.pendingItems.some(item=>item.pendingCode==='MATERIAL_HTTP_403'));
  assert.equal(job.materialMask[0],'0');assert.equal(result.materialPending,1);assert.equal(job.phase,'MATERIALS');
  assert.equal([...h.forms.values()].some(form=>form.isPublished()),false);assert.equal([...h.store.values()].some(record=>record.status==='READY'),false);
  file.failAdd=false;job.materialCursor=0;assert.equal(h.ctx.trainingReleaseMaterialBatch_(loaded,job).materialPrepared,84);
  assert.equal(file.permissions.filter(permission=>permission.role==='reader').length,1);
});

test('limited access changes only the cloned folder while preserving its external parent and originals',()=>{
  const h=fixture(),loaded=h.load(),folder=h.files.get(roots[3][0]);folder.ownerMetadata.inheritedPermissionsDisabled=false;
  const originalIds=h.manifest.items.slice(45).map(item=>item.sourceId),before=copy(originalIds.map(id=>h.files.get(id).ownerMetadata));
  assert.equal(h.ctx.trainingReleaseLimitClone_(loaded),true);
  assert.deepEqual(h.mutations.map(mutation=>({id:mutation.id,method:mutation.method,payload:mutation.payload})),[{id:roots[3][0],method:'patch',payload:{inheritedPermissionsDisabled:true}}]);
  assert.deepEqual(originalIds.map(id=>h.files.get(id).ownerMetadata),before);assert.equal(folder.permissions.length,1);
  assert.equal(h.mutations.some(mutation=>mutation.id==='1AHqrb1elRlNSmw8L3t_z53gTOo6YjLU2'||mutation.id==='1Kx9FZRhlj2grDbGSH8opHU3pQFemReyG'),false);
  folder.permissions.push({id:'inherited-metadata',type:'anyone',role:'reader',view:'metadata',inheritedPermissionsDisabled:true,permissionDetails:[{inherited:true,inheritedFrom:'1AHqrb1elRlNSmw8L3t_z53gTOo6YjLU2'}]});
  assert.equal(h.ctx.trainingReleaseCloneAccess_(loaded),true);
  folder.permissions.push({id:'folder-content',type:'user',role:'reader',emailAddress:'general@example.invalid'});
  assert.throws(()=>h.ctx.trainingReleaseLimitClone_(loaded),/CLONE_FOLDER_READERS/);assert.equal(h.mutations.length,1);
});

test('changed approved roster resets material proof and closes Forms before further material writes',()=>{
  const h=fixture(),loaded=h.load(),job=materialJob(h);h.ctx.trainingReleaseMaterialBatch_(loaded,job);
  job.materialMask='1'.repeat(84);job.phase='MATERIALS';job.verifiedMask='1'.repeat(76);h.forms.get(h.manifest.items[0].formId).setPublished(true);
  h.seed('users','new-general',{uid:'new-general',email:'new-general@example.invalid',active:true,access:true,permissions:{}});
  h.seed('documentAccessEmails','new-general@example.invalid',{email:'new-general@example.invalid',active:true,groups:['GENERAL']});
  const result=h.ctx.trainingReleaseMaterialBatch_(loaded,job);assert.equal(result.attemptedForms,76);assert.equal(job.phase,'MATERIALS');
  assert.equal(job.materialMask,'0'.repeat(84));assert.equal(job.verifiedMask,'0'.repeat(76));assert.equal(h.forms.get(h.manifest.items[0].formId).isPublished(),false);assert.equal(h.mutations.length,0);
});

test('publication hook rechecks material reader revocation after READY',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[0];h.ctx.trainingReleasePrepared_(loaded,item);assert.equal(h.ctx.trainingReleaseReleased_(loaded,item).status,'READY');
  const file=h.files.get(materialId(item));file.permissions=file.permissions.filter(permission=>permission.role==='owner');
  assert.equal(h.ctx.formsEvaluationFinalizePublication_(item.formId).status,'CONFIGURATION_PENDING');
  assert.equal(h.forms.get(item.formId).isPublished(),false);assert.equal(h.forms.get(item.formId).isAcceptingResponses(),false);assert.equal(h.get('evaluationFormConfigs',item.formId).trainingReleaseBlocked,true);
  assert.equal(h.get('scopedDocuments',`evaluation_${item.formId}`).active,false,'periodic reconciliation also hides the owned Management topic');
  assert.equal(h.mutations.filter(mutation=>mutation.id===materialId(item)).length,0,'generic publication hook inspects material ACL without repairing it');
});

test('Management topics appear only after live READY with group, responder URL and no private quiz data',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[18],id=`evaluation_${item.formId}`;
  h.ctx.trainingReleasePrepared_(loaded,item);assert.equal(h.get('scopedDocuments',id),null);
  assert.equal(h.ctx.trainingReleaseReleased_(loaded,item).status,'READY');
  const doc=h.get('scopedDocuments',id),cfg=h.get('evaluationFormConfigs',item.formId);
  assert.equal(doc.active,true);assert.equal(doc.audienceGroup,'RESTRICTED');assert.equal(doc.category,'DOCUMENTOS ADMINISTRATIVOS');
  assert.equal(doc.driveUrl,cfg.responderUrl);assert.equal(doc.driveFileId,item.formId);assert.equal(doc.requiredReading,true);assert.equal(doc.version,1);
  assert.deepEqual(Object.keys(doc).filter(key=>!key.startsWith('_')).sort(),['id','managementAreaId','title','description','driveFileId','driveUrl','version','category','active','publishedAt','requiredReading','createdByUid','createdAt','updatedByUid','updatedAt','audienceGroup'].sort());
  assert.equal(doc.createdByUid,'admin');assert.equal(doc.updatedByUid,'admin');assert.ok(doc.createdAt instanceof Date);assert.ok(doc.publishedAt instanceof Date);
  const writes=h.commits.flat().filter(write=>write.collection==='scopedDocuments');assert.equal(writes.length,1);
  assert.deepEqual(writes[0].times,['publishedAt','createdAt','updatedAt']);
  h.ctx.trainingReleaseReleased_(loaded,item);assert.equal(h.commits.flat().filter(write=>write.collection==='scopedDocuments').length,1);
});

test('closing and repairing owned Management topic preserves creation stamps and increments version',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[0],id=`evaluation_${item.formId}`;
  h.ctx.trainingReleasePrepared_(loaded,item);h.ctx.trainingReleaseReleased_(loaded,item);const before=h.get('scopedDocuments',id);
  h.advance(2000);assert.equal(h.ctx.trainingReleaseFailClosed_(item),true);const closed=h.get('scopedDocuments',id);
  assert.equal(closed.active,false);assert.equal(closed.version,2);assert.deepEqual(closed.createdAt,before.createdAt);assert.deepEqual(closed.publishedAt,before.publishedAt);
  h.advance(2000);assert.equal(h.ctx.trainingReleaseReleased_(loaded,item).status,'READY');const repaired=h.get('scopedDocuments',id);
  assert.equal(repaired.active,true);assert.equal(repaired.version,3);assert.deepEqual(repaired.createdAt,before.createdAt);assert.deepEqual(repaired.publishedAt,before.publishedAt);
});

test('Management document conflicts preserve manual edits and keep the Form closed',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[0],id=`evaluation_${item.formId}`;
  h.ctx.trainingReleasePrepared_(loaded,item);h.ctx.trainingReleaseReleased_(loaded,item);
  h.seed('scopedDocuments',id,{...h.get('scopedDocuments',id),title:'Título editado manualmente',version:2});const before=h.get('scopedDocuments',id);
  assert.equal(h.ctx.liberarCatalogoTreinamentosSahmtV2().status,'CONFIGURATION_PENDING');
  assert.deepEqual(h.get('scopedDocuments',id),before);assert.equal(h.forms.get(item.formId).isPublished(),false);assert.equal(h.get('evaluationFormConfigs',item.formId).status,'CONFIGURATION_PENDING');
});

test('Management projection rejects stale config version without creating an announcement',()=>{
  const h=fixture(),loaded=h.load(),item=h.manifest.items[0],id=`evaluation_${item.formId}`;
  h.ctx.trainingReleasePrepared_(loaded,item);h.ctx.trainingReleaseReleased_(loaded,item);const cfg=h.get('evaluationFormConfigs',item.formId);
  h.store.delete(`scopedDocuments/${id}`);h.seed('evaluationFormConfigs',item.formId,{...cfg,configVersion:cfg.configVersion+1});
  assert.throws(()=>h.ctx.trainingReleaseManagement_(loaded,item,cfg),/MANAGEMENT_PUBLICATION_CHANGED/);assert.equal(h.get('scopedDocuments',id),null);
});

test('slow material reads reserve fresh readback time and advance past already verified files',()=>{
  const h=fixture(),loaded=h.load(),job=materialJob(h),metadata=h.ctx.trainingReleaseMaterialMetadata_,permissions=h.ctx.trainingReleaseMaterialPermissions_;
  h.ctx.trainingReleaseMaterialMetadata_=(...args)=>{const value=metadata(...args);h.advance(1500);return value;};
  h.ctx.trainingReleaseMaterialPermissions_=(...args)=>{const value=permissions(...args);h.advance(1500);return value;};
  const first=h.ctx.trainingReleaseMaterialBatch_(loaded,job);assert.ok(first.materialPrepared>0&&first.materialPrepared<84);
  const readyIds=new Set(plain(h.ctx.trainingReleaseMaterialCatalog_(loaded)).filter((entry,index)=>job.materialMask[index]==='1').map(entry=>entry.id));
  assert.ok(job.materialCursor>0);h.readbacks.length=0;
  for(let run=0;run<8&&job.phase!=='FORMS';run++)h.ctx.trainingReleaseMaterialBatch_(loaded,job);
  assert.equal(job.materialMask,'1'.repeat(84));assert.equal(job.phase,'FORMS');
  assert.equal(h.readbacks.some(read=>readyIds.has(read.id)),false,'finished checkpoints are not reread during setup waves');
  const item=h.manifest.items.find(entry=>entry.materialUrls.some(url=>readyIds.has(url.match(/\/d\/([^/]+)/)[1])));
  h.ctx.trainingReleaseMaterialVerify_(loaded,item);assert.equal(h.readbacks.some(read=>readyIds.has(read.id)),true,'publication still revalidates the live ACL');
});
