// Bounded, owner-armed ROP release. Uses current FB identities and existing scoring gates.
function ropsReleaseLoad_() {
  if(typeof doPost!=='function'||!doPost.toString().includes("diretrizes-reading-v1"))throw Error('ROPS_READING_DISPATCH_MISSING');
  ropsOwner_();const cfg=ropsReadingReleaseConfig_(),file=DriveApp.getFileById(cfg.manifestId);
  if(file.isTrashed()||file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('ROPS_RELEASE_NOT_PRIVATE');
  const raw=file.getBlob().getDataAsString('UTF-8');if(formsEvaluationHash_(raw)!==cfg.manifestSha256)throw Error('ROPS_RELEASE_MANIFEST_CHANGED');
  const manifest=JSON.parse(raw),materials=ropsMaterialManifest_();
  if(manifest.code!=='ROPS_READING_RELEASE_MANIFEST'||manifest.version!==1||manifest.items.length!==20||manifest.materialManifestSha256!==materials.cfg.manifestSha256||manifest.managerAreaId!=='area-gestao-de-documentos')throw Error('ROPS_RELEASE_MANIFEST_INVALID');
  const ids=new Set();manifest.items.forEach(function(row){if(ids.has(row.formId)||!materials.items.some(function(m){return m.formId===row.formId&&m.folderId===row.folderId;})||!Number.isInteger(row.version)||row.version<1||!Number.isInteger(row.expectedConfigVersion)||row.expectedConfigVersion<0||!Number.isInteger(row.maxTestScore)||row.maxTestScore<1||!/^[a-f0-9]{64}$/.test(row.expectedItemsHash))throw Error('ROPS_RELEASE_BINDING_INVALID');ids.add(row.formId);});
  return {cfg:cfg,manifest:manifest,materials:materials.items};
}
function ropsReleaseContext_(loaded,tx) {
  const m=loaded.manifest,admin=evaluationGet_('users',m.actorUid,tx),assignment=evaluationGet_('evaluationAssignments',m.managerAreaId,tx),area=evaluationGet_('managementAreas',m.managerAreaId,tx);
  if(evaluationProject_()!=='sahmt-gestao-5ae66'||!formsEvaluationAdmin_(admin)||!area||area.active!==true||!assignment||assignment.uid!==m.managerUid||assignment.version!==m.assignmentVersion||!formsEvaluationActive_(evaluationGet_('users',assignment.uid,tx)))throw Error('ROPS_RELEASE_AUTHORIZATION_CHANGED');
  return assignment;
}
function ropsReleaseLive_(loaded,row) {
  const material=loaded.materials.find(function(m){return m.formId===row.formId;}),metadata=formsEvaluationMetadata_(row.formId);
  if(formsEvaluationHash_({formId:row.formId,items:metadata.items||[]})!==row.expectedItemsHash||ropsScored_(metadata).length!==5)throw Error('ROPS_RELEASE_FORM_CHANGED');
  dgrPdf_({pdfId:material.pdfId,checksum:material.pdfMd5},false);
  const payload={modalities:{acknowledgement:true,suggestion:true,test:true},acknowledgementItemId:row.acknowledgementItemId,acknowledgementValue:row.acknowledgementValue,suggestionTextItemId:row.suggestionTextItemId},checked=formsEvaluationConfiguration_(metadata,payload);
  if(checked.maxTestScore!==row.maxTestScore)throw Error('ROPS_RELEASE_SCORE_CHANGED');
  const fingerprint=formsEvaluationMaterialFingerprint_([{contentHash:material.pdfMd5}]),digest=formsEvaluationHash_({formId:row.formId,questionFingerprint:checked.questionFingerprint,materialFingerprint:fingerprint,creditScopeId:row.creditScopeId,version:row.version});
  return {metadata:metadata,checked:checked,material:material,materialFingerprint:fingerprint,digest:digest,mapping:payload};
}
function ropsTrainingReleaseVerify_(formId) {
  if(!gpdfProps_().getProperty('SAHMT_ROPS_READING_JOB'))return null;
  const loaded=ropsReleaseLoad_(),row=loaded.manifest.items.find(function(item){return item.formId===formId;});if(!row)return null;
  ropsReleaseContext_(loaded,null);const live=ropsReleaseLive_(loaded,row),cfg=evaluationGet_('evaluationFormConfigs',formId),activity=evaluationGet_('evaluationActivities',formId);
  if(!cfg||!activity||cfg.creditScopeId!==row.creditScopeId||cfg.version!==row.version||cfg.configuredByUid!==loaded.manifest.actorUid||cfg.maxTestScore!==row.maxTestScore||formsEvaluationSavedQuestionFingerprint_(cfg)!==live.checked.questionFingerprint||cfg.materialFingerprint!==live.materialFingerprint||formsEvaluationStable_(cfg.mapping)!==formsEvaluationStable_(live.checked.mapping)||formsEvaluationStable_(cfg.eligibleGroups)!==formsEvaluationStable_(['GENERAL'])||cfg.eligibleUids.length||activity.trainingReleaseManifestDigest!==loaded.cfg.manifestSha256||activity.trainingReleaseDigest!==live.digest||activity.trainingReleaseClosedBaseline!==true)throw Error('ROPS_RELEASE_PROOF_CHANGED');
  return {formId:formId,manifestDigest:loaded.cfg.manifestSha256,formDigest:live.digest};
}
function ropsReleaseRemoveTrigger_() {ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='continuarLeituraRopsFbV1';}).forEach(function(t){ScriptApp.deleteTrigger(t);});}
function prepararLeituraRopsFbV1() {
  ropsOwner_();if(String(Session.getActiveUser().getEmail()||'').toLowerCase()!=='anestesiahmtforms@gmail.com')throw Error('ROPS_OPERATOR_DENIED');evaluationAssertOperator_(true);
  const props=gpdfProps_(),loaded=ropsReleaseLoad_();ropsReleaseContext_(loaded,null);
  if(ropsPdfPairs_().length!==20)throw Error('ROPS_MATERIAL_INSTALL_REQUIRED');
  if(!props.getProperty('SAHMT_ROPS_READING_JOB')){
    const bootstrapLock=LockService.getScriptLock();if(!bootstrapLock.tryLock(5000))throw Error('ROPS_READING_BUSY');
    try{
    ropsQueueMaterials_();
    const initializing=props.getProperty('SAHMT_ROPS_READING_INITIALIZING');
    let recovery,record;
    if(initializing){
      recovery=DriveApp.getFileById(initializing);if(recovery.isTrashed()||recovery.getSharingAccess()!==DriveApp.Access.PRIVATE||recovery.getEditors().length||recovery.getViewers().length)throw Error('ROPS_RELEASE_RECOVERY_NOT_PRIVATE');
      record=JSON.parse(recovery.getBlob().getDataAsString('UTF-8'));if(record.manifestSha256!==loaded.cfg.manifestSha256||record.index!==0||record.runs!==0||Date.now()-Date.parse(record.createdAt)>86400000)throw Error('ROPS_RELEASE_INITIALIZATION_CHANGED');
      if(props.getProperty('SAHMT_READING_POLICY_JSON')&&formsEvaluationHash_(dgrPolicy_())!==formsEvaluationHash_(record.policy))throw Error('ROPS_RELEASE_INITIALIZATION_CHANGED');
    }else{
    if(props.getProperty('SAHMT_READING_POLICY_JSON')||props.getProperty('SAHMT_READING_ENABLED')==='YES')throw Error('ROPS_EXISTING_READING_POLICY_REQUIRES_MERGE');
    const users=formsEvaluationAll_('users'),access=formsEvaluationAll_('documentAccessEmails'),roster=formsEvaluationFilterGroupRoster_(access,['GENERAL']).map(function(entry){return entry.email;});
    const uids=users.filter(function(profile){const p=profile.permissions||{};return formsEvaluationActive_(profile)&&profile.uid===profile.id&&roster.includes(String(profile.email||'').toLowerCase())&&(profile.role==='administrador_app'||p.admin===true||p.managementRead===true||p.documentsManage===true);}).map(function(profile){return profile.uid;});
    if(!uids.includes(loaded.manifest.actorUid)||!uids.length)throw Error('ROPS_READING_AUDIENCE_INVALID');
    const policy={version:1,pilotUids:uids,documents:{}};loaded.manifest.items.forEach(function(row){const material=loaded.materials.find(function(m){return m.formId===row.formId;});policy.documents['evaluation_'+row.formId]={formId:row.formId,pdfId:material.pdfId,checksum:material.pdfMd5,pages:material.pages,version:row.version,enforced:false,category:'ROPs',audienceGroup:'GENERAL',pdfDocumentId:'pdf_evaluation_'+row.formId,sourceFileId:material.sourceId};});
    record={code:'ROPS_READING_RECOVERY',manifestSha256:loaded.cfg.manifestSha256,createdAt:new Date().toISOString(),index:0,runs:0,results:[],backups:[],policy:policy};
    recovery=DriveApp.createFile('SAHMT ROPs — recuperação da liberação.json',JSON.stringify(record),MimeType.PLAIN_TEXT);props.setProperty('SAHMT_ROPS_READING_INITIALIZING',recovery.getId());
    }
    const priorSecret=props.getProperty('SAHMT_READING_HMAC_SECRET');if(priorSecret&&priorSecret!==loaded.cfg.readingHmacSecret)throw Error('ROPS_READING_SECRET_CONFLICT');
    props.setProperty('SAHMT_READING_HMAC_SECRET',loaded.cfg.readingHmacSecret);props.setProperty('SAHMT_READING_OPERATOR_EMAIL','anestesiahmtforms@gmail.com');props.setProperty('SAHMT_READING_ENABLED','NO');dgrStorePolicy_(record.policy);
    props.setProperty('SAHMT_ROPS_READING_JOB',recovery.getId());props.deleteProperty('SAHMT_ROPS_READING_INITIALIZING');
    }finally{bootstrapLock.releaseLock();}
  }
  return continuarLeituraRopsFbV1();
}
function ropsReleasePrepareOne_(loaded,row,state,file) {
  if(typeof ropsRepairEditable_==='function')ropsRepairEditable_(row.formId,state,file);
  const live=ropsReleaseLive_(loaded,row),form=FormApp.openById(row.formId),props=gpdfProps_(),protectedIds=String(props.getProperty('SAHMT_V2_EVALUATION_PROTECTED_FORM_IDS')||'').split(/[\s,;]+/);
  if(protectedIds.includes(row.formId)||!form.supportsAdvancedResponderPermissions())throw Error('ROPS_FORM_RELEASE_UNSUPPORTED');
  let backup=state.backups.find(function(b){return b.formId===row.formId;});
  const previous=evaluationGet_('evaluationFormConfigs',row.formId),projected=evaluationGet_('evaluationActivities',row.formId);
  if(!backup){if((previous?previous.configVersion:0)!==row.expectedConfigVersion)throw Error('ROPS_CONFIGURATION_CHANGED');const permissions=formsEvaluationPublishedPermissions_(row.formId);backup={formId:row.formId,configuration:previous,activity:projected,documents:[evaluationGet_('scopedDocuments','evaluation_'+row.formId),evaluationGet_('scopedDocuments','pdf_evaluation_'+row.formId)],permissions:permissions,normalFingerprint:dgrNormalFingerprint_(permissions),wasPublished:form.isPublished(),wasAccepting:form.isAcceptingResponses()};state.backups.push(backup);file.setContent(JSON.stringify(state));}
  formsEvaluationCloseForm_(form);
  const already=previous&&previous.ropsReleaseManifestDigest===loaded.cfg.manifestSha256&&previous.version===row.version;
  if(!already){
    if((previous?previous.configVersion:0)!==row.expectedConfigVersion)throw Error('ROPS_CONFIGURATION_CHANGED');
    form.setLimitOneResponsePerUser(!formsEvaluationRepeatPolicy_(previous));form.setAllowResponseEdits(false);
    evaluationRunTransaction_(function(tx){ropsReleaseContext_(loaded,tx);const activity=evaluationGet_('evaluationActivities',row.formId,tx),cfg=evaluationGet_('evaluationFormConfigs',row.formId,tx);if((cfg?cfg.configVersion:0)!==row.expectedConfigVersion||cfg&&cfg.creditScopeId!==row.creditScopeId)throw Error('ROPS_CONFIGURATION_CHANGED');
      return {writes:[evaluationWrite_('evaluationActivities',row.formId,{id:row.formId,formId:row.formId,title:row.title,active:true,areaIds:[loaded.manifest.managerAreaId],status:'CONFIGURATION_PENDING',trainingReleaseBlocked:true,trainingReleaseManifestDigest:loaded.cfg.manifestSha256,trainingReleaseDigest:live.digest,trainingReleaseClosedBaseline:true,sourceId:activity&&activity.sourceId||row.folderId,rootId:row.rootId},activity,['updatedAt'])],result:{}};});
    const payload=Object.assign({},live.mapping,{activityId:row.formId,creditScopeId:row.creditScopeId,version:row.version,expectedVersion:row.expectedConfigVersion,eligibleUids:[],eligibleGroups:['GENERAL'],managerAreaId:loaded.manifest.managerAreaId,validFrom:loaded.manifest.validFrom,validUntil:loaded.manifest.validUntil,materialUrls:['https://drive.google.com/file/d/'+live.material.pdfId+'/view']});
    evaluationRunTransaction_(function(tx){ropsReleaseContext_(loaded,tx);const result=formsEvaluationConfigured_(payload,loaded.manifest.actorUid,tx);result.writes.forEach(function(write){write.update.fields.ropsReleaseManifestDigest={stringValue:loaded.cfg.manifestSha256};if(write.updateMask&&!write.updateMask.fieldPaths.includes('ropsReleaseManifestDigest'))write.updateMask.fieldPaths.push('ropsReleaseManifestDigest');});return result;});
  }
  trainingRepeatActivateOne_(row.formId);
  const cfg=evaluationGet_('evaluationFormConfigs',row.formId);if(cfg.version!==row.version||cfg.materialFingerprint!==live.materialFingerprint||formsEvaluationSavedQuestionFingerprint_(cfg)!==live.checked.questionFingerprint)throw Error('ROPS_CONFIGURATION_POSTCHECK');
  evaluationRunTransaction_(function(tx){ropsReleaseContext_(loaded,tx);const current=evaluationGet_('evaluationFormConfigs',row.formId,tx),activity=evaluationGet_('evaluationActivities',row.formId,tx);if(current.configVersion!==cfg.configVersion)throw Error('ROPS_CONFIGURATION_CHANGED');
    const writes=[],common={managementAreaId:loaded.manifest.managerAreaId,title:row.title,description:'Leitura do material, ciência, avaliação de cinco questões e sugestões.',category:'ROPs',audienceGroup:'GENERAL',requiredReading:true,active:false,readingGateRequired:true,updatedByUid:loaded.manifest.actorUid};
    [['evaluation_'+row.formId,row.formId,cfg.responderUrl],['pdf_evaluation_'+row.formId,live.material.pdfId,'https://drive.google.com/file/d/'+live.material.pdfId+'/view']].forEach(function(parts){const old=evaluationGet_('scopedDocuments',parts[0],tx),changes=Object.assign({},common,{id:parts[0],driveFileId:parts[1],driveUrl:parts[2],version:old?old.version+1:1});if(!old)changes.createdByUid=loaded.manifest.actorUid;writes.push(evaluationWrite_('scopedDocuments',parts[0],changes,old,old?['updatedAt']:['createdAt','updatedAt','publishedAt']));});
    const alias=formsEvaluationLink_(cfg.responderUrl);if(!alias)throw Error('ROPS_RESPONDER_URL_INVALID');const linkId='link-'+formsEvaluationHash_('scopedDocuments\u0000evaluation_'+row.formId+'\u0000'+alias.aliasKey),link=evaluationGet_('evaluationLinks',linkId,tx);writes.push(evaluationWrite_('evaluationLinks',linkId,{id:linkId,sourceCollection:'scopedDocuments',sourceId:'evaluation_'+row.formId,sourceVersion:row.version,areaIds:[loaded.manifest.managerAreaId],aliasKey:alias.aliasKey,normalizedUrl:alias.normalizedUrl,formId:row.formId,active:true,status:'CONFIGURATION_PENDING',reason:'Liberação individual após leitura.'},link,['updatedAt']));return {writes:writes,result:{}};});
  const before=formsEvaluationPublishedPermissions_(row.formId);if(dgrNormalFingerprint_(before)!==backup.normalFingerprint)throw Error('ROPS_FORM_EDITORS_CHANGED');dgrRemovePublished_(row.formId,before);
  const after=formsEvaluationPublishedPermissions_(row.formId);if(after.some(function(p){return p.view==='published';})||dgrNormalFingerprint_(after)!==backup.normalFingerprint)throw Error('ROPS_RESPONDERS_NOT_CLOSED');
  form.setPublished(true);form.setAcceptingResponses(true);if(!form.isPublished()||!form.isAcceptingResponses()||formsEvaluationPublishedPermissions_(row.formId).some(function(p){return p.view==='published';}))throw Error('ROPS_RESPONDERS_NOT_CLOSED');
  ropsTrainingReleaseVerify_(row.formId);
  evaluationRunTransaction_(function(tx){ropsReleaseContext_(loaded,tx);const current=evaluationGet_('evaluationFormConfigs',row.formId,tx),activity=evaluationGet_('evaluationActivities',row.formId,tx);if(current.configVersion!==cfg.configVersion||current.version!==row.version||activity.trainingReleaseDigest!==live.digest)throw Error('ROPS_READY_COMMIT_CONFLICT');const changes={status:'READY',reason:'',publicationPending:false,trainingReleaseBlocked:false,ropsReleaseManifestDigest:loaded.cfg.manifestSha256};return {writes:[evaluationWrite_('evaluationFormConfigs',row.formId,changes,current,['updatedAt','accessVerifiedAt']),evaluationWrite_('evaluationActivities',row.formId,changes,activity,['updatedAt','accessVerifiedAt'])],result:{}};});
  state.policy.documents['evaluation_'+row.formId].enforced=true;return {formId:row.formId,status:'READY_READING_ONLY',version:row.version};
}
function continuarLeituraRopsFbV1() {
  ropsOwner_();evaluationAssertOperator_(true);const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'ROPS_READING_BUSY'};
  let current;
  try{
    const loaded=ropsReleaseLoad_(),props=gpdfProps_(),file=DriveApp.getFileById(props.getProperty('SAHMT_ROPS_READING_JOB'));if(file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('ROPS_RELEASE_RECOVERY_NOT_PRIVATE');
    const state=JSON.parse(file.getBlob().getDataAsString('UTF-8'));if(state.manifestSha256!==loaded.cfg.manifestSha256||!Number.isInteger(state.index)||state.index<0||state.index>20||Date.now()-Date.parse(state.createdAt)>86400000||++state.runs>30)throw Error('ROPS_RELEASE_STATE_INVALID');file.setContent(JSON.stringify(state));
    if(state.active===true&&props.getProperty('SAHMT_READING_ENABLED')==='YES'&&formsEvaluationHash_(dgrPolicy_())===formsEvaluationHash_(state.policy))return {code:'ROPS_EBOOK_TRAINING_ACTIVE',completed:20,verified:20,total:20,readingEnabled:true,financialWrites:0};
    state.active=false;
    const began=Date.now();for(let count=0;state.index<20&&count<2&&Date.now()-began<150000;state.index++,count++){const row=loaded.manifest.items[state.index];current=FormApp.openById(row.formId);const result=ropsReleasePrepareOne_(loaded,row,state,file);if(!state.results.some(function(r){return r.formId===row.formId;}))state.results.push(result);current=null;file.setContent(JSON.stringify(state));}
    file.setContent(JSON.stringify(state));ropsReleaseRemoveTrigger_();
    if(state.index===20){state.verifyIndex=state.verifyIndex||0;for(let count=0;state.verifyIndex<20&&count<5&&Date.now()-began<150000;state.verifyIndex++,count++){
      const row=loaded.manifest.items[state.verifyIndex];if(typeof ropsRepairEditable_==='function')ropsRepairEditable_(row.formId,state,file);ropsTrainingReleaseVerify_(row.formId);const form=FormApp.openById(row.formId);if(!form.isPublished()||!form.isAcceptingResponses()||formsEvaluationPublishedPermissions_(row.formId).some(function(p){return p.view==='published';}))throw Error('ROPS_READING_AUDIENCE_CHANGED');file.setContent(JSON.stringify(state));
    }file.setContent(JSON.stringify(state));}
    const complete=state.index===20&&state.verifyIndex===20;
    if(complete){dgrStorePolicy_(state.policy);props.setProperty('SAHMT_READING_CUTOVER_SHA256',formsEvaluationHash_(state.policy.documents));props.setProperty('SAHMT_READING_ENABLED','NO');state.complete=true;file.setContent(JSON.stringify(state));}
    else ScriptApp.newTrigger('continuarLeituraRopsFbV1').timeBased().after(60000).create();
    let waitingForPwa=false;
    if(complete&&loaded.cfg.autoActivate===true){
      if(!/^sahmt-fb-v2-shell-v[0-9]+$/.test(loaded.cfg.pwaCache||''))throw Error('ROPS_READER_RELEASE_NOT_CONFIGURED');
      const shell=UrlFetchApp.fetch('https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/gestao/service-worker.js',{headers:{'Cache-Control':'no-cache'},muteHttpExceptions:true,followRedirects:false});
      waitingForPwa=shell.getResponseCode()!==200||!shell.getContentText().includes(loaded.cfg.pwaCache);
      if(waitingForPwa)ScriptApp.newTrigger('continuarLeituraRopsFbV1').timeBased().after(180000).create();
      else {ropsActivateReading_(loaded,state);state.active=true;file.setContent(JSON.stringify(state));}
    }
    const result={code:state.active?'ROPS_EBOOK_TRAINING_ACTIVE':waitingForPwa?'ROPS_READING_WAITING_PWA':complete?'ROPS_READING_BACKEND_READY':'ROPS_READING_PROGRESS',completed:state.index,verified:state.verifyIndex||0,total:20,privateRecoveryUrl:file.getUrl(),automaticContinuation:!complete||waitingForPwa,readingEnabled:state.active===true,financialWrites:0};console.log(JSON.stringify(result));return result;
  }catch(error){ropsReleaseRemoveTrigger_();if(current)try{formsEvaluationCloseForm_(current);}catch(_){}throw error;}finally{lock.releaseLock();}
}
function ropsActivateReading_(loaded,state) {
  ropsOwner_();evaluationAssertOperator_(true);ropsReleaseContext_(loaded,null);
  if(!state.complete||state.index!==20||state.verifyIndex!==20||state.manifestSha256!==loaded.cfg.manifestSha256)throw Error('ROPS_BACKEND_VERIFICATION_REQUIRED');
  const props=gpdfProps_(),policy=dgrPolicy_();if(formsEvaluationHash_(policy)!==formsEvaluationHash_(state.policy)||props.getProperty('SAHMT_READING_CUTOVER_SHA256')!==formsEvaluationHash_(policy.documents)||props.getProperty('SAHMT_READING_HMAC_SECRET')!==loaded.cfg.readingHmacSecret)throw Error('ROPS_READING_POLICY_CHANGED');
  if(loaded.cfg.readerEndpoint!=='https://sahmt-auth-broker.anestesiahmtforms.workers.dev/v1/diretrizes/reading'||!/^sahmt-fb-v2-shell-v[0-9]+$/.test(loaded.cfg.pwaCache||''))throw Error('ROPS_READER_RELEASE_NOT_CONFIGURED');
  const probe=UrlFetchApp.fetch(loaded.cfg.readerEndpoint,{method:'post',contentType:'application/json',headers:{Origin:'https://anestesiahmtforms.github.io'},payload:'{}',muteHttpExceptions:true,followRedirects:false});
  if(probe.getResponseCode()!==401||JSON.parse(probe.getContentText()||'{}').code!=='READING_IDENTITY_DENIED')throw Error('ROPS_READER_SERVICE_NOT_READY');
  const shell=UrlFetchApp.fetch('https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/gestao/service-worker.js',{headers:{'Cache-Control':'no-cache'},muteHttpExceptions:true,followRedirects:false});if(shell.getResponseCode()!==200||!shell.getContentText().includes(loaded.cfg.pwaCache))throw Error('ROPS_PWA_RELEASE_NOT_READY');
  loaded.manifest.items.forEach(function(row){ropsTrainingReleaseVerify_(row.formId);const form=FormApp.openById(row.formId),permissions=formsEvaluationPublishedPermissions_(row.formId),backup=state.backups.find(function(b){return b.formId===row.formId;});if(!backup||!form.isPublished()||!form.isAcceptingResponses()||permissions.some(function(p){return p.view==='published';})||dgrNormalFingerprint_(permissions)!==backup.normalFingerprint)throw Error('ROPS_READING_AUDIENCE_CHANGED');});
  evaluationRunTransaction_(function(tx){ropsReleaseContext_(loaded,tx);const writes=[];
    loaded.manifest.items.forEach(function(row){const cfg=evaluationGet_('evaluationFormConfigs',row.formId,tx),activity=evaluationGet_('evaluationActivities',row.formId,tx),material=loaded.materials.find(function(m){return m.formId===row.formId;});
      if(!cfg||!activity||cfg.status!=='READY'||activity.status!=='READY'||cfg.version!==row.version||cfg.ropsReleaseManifestDigest!==loaded.cfg.manifestSha256||activity.trainingReleaseManifestDigest!==loaded.cfg.manifestSha256)throw Error('ROPS_READY_CONFIGURATION_CHANGED');
      [['evaluation_'+row.formId,row.formId,cfg.responderUrl],['pdf_evaluation_'+row.formId,material.pdfId,'https://drive.google.com/file/d/'+material.pdfId+'/view']].forEach(function(parts){const doc=evaluationGet_('scopedDocuments',parts[0],tx);if(!doc||doc.driveFileId!==parts[1]||doc.driveUrl!==parts[2]||doc.category!=='ROPs'||doc.audienceGroup!=='GENERAL'||doc.managementAreaId!==loaded.manifest.managerAreaId||doc.readingGateRequired!==true)throw Error('ROPS_READING_CATALOG_CHANGED');if(doc.active!==true)writes.push(evaluationWrite_('scopedDocuments',parts[0],{active:true,version:doc.version+1,updatedByUid:loaded.manifest.actorUid},doc,['updatedAt']));});
    });return {writes:writes,result:{}};
  });
  Object.keys(policy.documents).forEach(function(id){dgrCatalog_(id,policy.documents[id]);});props.setProperty('SAHMT_READING_ENABLED','YES');
}
function ativarLeituraRopsFbV1() {
  ropsOwner_();if(String(Session.getActiveUser().getEmail()||'').toLowerCase()!=='anestesiahmtforms@gmail.com')throw Error('ROPS_OPERATOR_DENIED');const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('ROPS_READING_BUSY');
  try{const loaded=ropsReleaseLoad_(),file=DriveApp.getFileById(gpdfProps_().getProperty('SAHMT_ROPS_READING_JOB'));if(file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('ROPS_RELEASE_RECOVERY_NOT_PRIVATE');const state=JSON.parse(file.getBlob().getDataAsString('UTF-8'));ropsActivateReading_(loaded,state);state.active=true;file.setContent(JSON.stringify(state));const result={code:'ROPS_EBOOK_TRAINING_ACTIVE',trainings:20,financialWrites:0};console.log(JSON.stringify(result));return result;}finally{lock.releaseLock();}
}
