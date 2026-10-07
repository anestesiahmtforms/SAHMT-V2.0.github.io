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
  let serial = 0, inTransaction = false, time = Date.parse('2026-10-06T15:00:00Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const ctx = vm.createContext({Date: Clock, Map, Set, JSON, Number, Object, Array, String, RegExp, Error, Math, encodeURIComponent,
    Utilities: {DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(_,text)=>Array.from(createHash('sha256').update(text).digest()),
      formatDate:date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date),getUuid:()=>`uuid-${++serial}`},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
    Session:{getEffectiveUser:()=>({getEmail:()=>operator})},
    Logger:{log:value=>logs.push(value)},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{assert.equal(minutes,5);const id=`trigger-${++serial}`;const t={getUniqueId:()=>id,getHandlerFunction:()=>handler};triggers.push(t);return t;}})})}),deleteTrigger:t=>{removedTriggers.push(t.getUniqueId());triggers.splice(triggers.indexOf(t),1);}},
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
  ctx.formsEvaluationGoogleRequest_ = (url, options={}) => {
    const formRoute=url.match(/^https:\/\/forms\.googleapis\.com\/v1\/forms\/([^/?]+)(?:\/responses.*)?$/);
    if(formRoute)return copy(url.includes('/responses')?{}:metadata.get(formRoute[1]));
    const fileRoute=url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/?]+)\?/);
    if(fileRoute)return copy(files.get(fileRoute[1])?.ownerMetadata);
    const permissionRoute=url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)\/permissions(?:\/([^?]+))?\?/);
    if(!permissionRoute)throw Error('Unexpected sensitive Google request');
    const id=permissionRoute[1],file=files.get(id),form=forms.get(id);
    if(!form)return {permissions:copy(file.permissions)};
    if(options.method==='delete'){assert.equal(inTransaction,false);form.permissions=form.permissions.filter(p=>p.id!==permissionRoute[2]);return {};}
    if(options.method==='post'){assert.equal(inTransaction,false);if(form.failAdd)throw Error('sensitive ACL failure');form.permissions.push({id:`grant-${++serial}`,...JSON.parse(options.payload)});return {};}
    return {permissions:copy(form.permissions)};
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
      setAcceptingResponses:value=>{if(value)assert.equal(inTransaction,false);accepting=value;return form;},
      setPublished:value=>{if(value)assert.equal(inTransaction,false);published=value;if(!value)accepting=false;return form;}};
    forms.set(formId,form);
    files.set(sourceId,{isTrashed:()=>false,getMimeType:()=>kind==='ROP'?'application/vnd.google-apps.form':'application/pdf',getParents:()=>parents([folders[kind==='ROP'?originalRopRoot:rootId]])});
    if(kind==='ROP')files.set(formId,{isTrashed:()=>false,getMimeType:()=> 'application/vnd.google-apps.form',getParents:()=>parents([folders[rootId]])});
    const item={formId,sourceId,rootId,title:meta.info.title,eligibleGroup:group,creditScopeId:`matter_${number}`,version:1,maxTestScore:scored,
      acknowledgementItemId:'aux-2',suggestionProblemItemId:'aux-4',suggestionProposalItemId:'aux-5',suggestionBenefitItemId:'aux-6',materialUrls:[`https://drive.google.com/file/d/${sourceId}/view`],validFrom:'2026-10-06',validUntil:'2026-12-31'};
    if(kind==='DOCUMENT'){item.expectedItems=copy(items);item.knownIds=Object.fromEntries(items.map(entry=>[entry.itemId,entry.questionItem?.question.questionId||null]));item.expectedItemsHash=ctx.trainingDocumentsHash_(items);}
    else item.preparedOriginalDigest=ctx.formsEvaluationHash_(ctx.ropsSecondSemesterComparable_(meta,false));
    manifest.items.push(item);
  }
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
  return {ctx,manifest,manifestId,manifestFile,properties,store,forms,files,folders,metadata,commits,logs,checks,triggers,removedTriggers,get,seed,seal,load:()=>ctx.trainingReleaseLoad_(),advance:milliseconds=>{time+=milliseconds;}};
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
  assert.ok(h.commits.flat().every(w=>['evaluationActivities','evaluationRequests','evaluationFormConfigs'].includes(w.collection)));assert.ok(h.checks.every(check=>check===false));
  assert.throws(()=>h.ctx.evaluationAssertOperator_(true),/Ativação bloqueada/);assert.equal(h.get('evaluationRuntime','state'),null);
});
test('ACL failure and audience expansion stay closed and pending; stale version never configures',()=>{
  for(const mutate of [h=>h.forms.get(h.manifest.items[0].formId).failAdd=true,h=>h.store.delete('documentAccessEmails/general@example.invalid')]){
    const h=fixture(),loaded=h.load(),item=h.manifest.items[0];h.ctx.trainingReleasePrepared_(loaded,item);mutate(h);const result=h.ctx.trainingReleaseReleased_(loaded,item);assert.equal(result.status,'CONFIGURATION_PENDING');assert.equal(h.forms.get(item.formId).isPublished(),false);
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
  const h=fixture();const result=h.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();assert.equal(result.status,'RUNNING');assert.equal(result.attemptedForms,5);assert.equal(result.publishedForms,5);assert.equal(h.triggers.length,1);
  const triggerId=h.triggers[0].getUniqueId();const before=copy([...h.properties]);assert.equal(h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2().runs,1);assert.deepEqual([...h.properties],before);
  h.manifestFile.permissions.push({type:'group',role:'reader'});assert.equal(h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_().status,'CONFIGURATION_PENDING');assert.deepEqual(h.removedTriggers,[triggerId]);assert.equal(h.triggers.length,0);
});
test('temporary job finishes 76 forms, preserves unrelated triggers, and expires without writes',()=>{
  const h=fixture();const unrelated={getUniqueId:()=> 'unrelated',getHandlerFunction:()=> 'anotherHandler'};h.triggers.push(unrelated);
  h.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();let result;
  for(let run=1;run<16;run++)result=h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_();
  assert.equal(result.status,'COMPLETED');assert.equal(result.publishedForms,76);assert.equal(result.validatedForms,76);assert.equal(result.liveFormsRevalidated,true);
  assert.deepEqual(h.triggers,[unrelated]);assert.equal(h.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_().status,'COMPLETED');
  assert.equal(h.ctx.consultarDisponibilizacaoTreinamentosSahmtV2().liveFormsRevalidated,false);
  const restarted=h.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();assert.equal(restarted.status,'RUNNING');assert.equal(restarted.publishedForms,76);assert.equal(restarted.validatedForms,5);assert.equal(restarted.liveFormsRevalidated,false);
  const expired=fixture();expired.ctx.iniciarDisponibilizacaoTreinamentosSahmtV2();expired.advance(86400000);const writes=expired.commits.length;
  assert.equal(expired.ctx.continuarDisponibilizacaoTreinamentosSahmtV2_().pendingCode,'JOB_LIMIT');assert.equal(expired.commits.length,writes);assert.equal(expired.triggers.length,0);
});
test('time budget stops scheduling further Forms and checkpoints preserve the next index',()=>{
  const h=fixture(),prepare=h.ctx.trainingReleasePrepared_;h.ctx.trainingReleasePrepared_=(loaded,item)=>{const result=prepare(loaded,item);h.advance(80000);return result;};
  const result=h.ctx.prepararCatalogoTreinamentosSahmtV2();assert.equal(result.attemptedForms,2);assert.equal(result.preparedForms,2);
  assert.equal(JSON.parse(h.properties.get('SAHMT_V2_TRAINING_RELEASE_CURSOR')).prepare,2);
});
