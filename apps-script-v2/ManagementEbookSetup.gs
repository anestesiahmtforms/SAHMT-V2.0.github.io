// Extends the existing FB reader. The exact file manifest is server-owned.
// One explicit owner launch arms a bounded job; requests cannot start this job.
function mgeManifest_() {
  const m=mgeTrustedManifest_(), ids=new Set();
  if(m.code!=='MANAGEMENT_EBOOK_SETUP_MANIFEST'||m.version!==1||m.projectId!=='sahmt-gestao-5ae66'||m.items.length!==42||m.managerAreaId!=='area-gestao-de-documentos')throw Error('MANAGEMENT_EBOOK_MANIFEST_INVALID');
  m.items.forEach(function(r){
    ['folderId','rootId','reviewFolderId','formId','pdfId','bankFileId'].forEach(function(k){if(!/^[A-Za-z0-9_-]{10,200}$/.test(r[k]||''))throw Error('MANAGEMENT_EBOOK_BINDING_INVALID');});
    if(ids.has(r.formId)||!['Protocolos','Diretrizes','Documentos administrativos'].includes(r.category)||!['GENERAL','RESTRICTED'].includes(r.audienceGroup)||r.category==='Documentos administrativos'&&r.audienceGroup!=='RESTRICTED'||!Number.isInteger(r.pages)||r.pages<1||r.pages>300||!/^[a-f0-9]{32}$/.test(r.checksum)||!Number.isInteger(r.expectedConfigVersion)||r.expectedConfigVersion<0)throw Error('MANAGEMENT_EBOOK_BINDING_INVALID');
    ids.add(r.formId);
  });return m;
}
function mgeContext_(m,tx) {
  const assignment=evaluationGet_('evaluationAssignments',m.managerAreaId,tx),area=evaluationGet_('managementAreas',m.managerAreaId,tx);
  if(evaluationProject_()!==m.projectId||!formsEvaluationAdmin_(evaluationGet_('users',m.actorUid,tx))||!area||area.active!==true||!assignment||assignment.uid!==m.managerUid||assignment.version!==m.assignmentVersion||!formsEvaluationActive_(evaluationGet_('users',assignment.uid,tx)))throw Error('MANAGEMENT_EBOOK_AUTHORIZATION_CHANGED');
}
function mgePrivate_(id) {
  const f=DriveApp.getFileById(id);if(f.isTrashed()||f.getSharingAccess()!==DriveApp.Access.PRIVATE||f.getEditors().length||f.getViewers().length||f.getOwner().getEmail().toLowerCase()!=='anestesiahmtforms@gmail.com')throw Error('MANAGEMENT_EBOOK_RECOVERY_NOT_PRIVATE');return f;
}
function mgeStopTrigger_(){ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='continuarLeituraDocumentosGestaoFbV1';}).forEach(function(t){ScriptApp.deleteTrigger(t);});}
function mgeArm_(){mgeStopTrigger_();ScriptApp.newTrigger('continuarLeituraDocumentosGestaoFbV1').timeBased().after(60000).create();}
function instalarLeituraDocumentosGestaoFbV1() {
  dgrOperator_();evaluationAssertOperator_(true);const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('MANAGEMENT_EBOOK_BUSY');
  try{
    const m=mgeManifest_(),props=gpdfProps_();mgeContext_(m,null);
    if(!props.getProperty('SAHMT_MANAGEMENT_EBOOK_JOB')){
      const policy=dgrPolicy_();if(props.getProperty('SAHMT_READING_ENABLED')!=='YES'||props.getProperty('SAHMT_READING_CUTOVER_SHA256')!==formsEvaluationHash_(policy.documents))throw Error('MANAGEMENT_EBOOK_EXISTING_READER_NOT_READY');
      const users=formsEvaluationAll_('users'),access=formsEvaluationAll_('documentAccessEmails'),roster=formsEvaluationFilterGroupRoster_(access,['GENERAL','RESTRICTED']).map(function(x){return x.email;});
      const uids=users.filter(function(p){const rights=p.permissions||{};return p.id===p.uid&&formsEvaluationActive_(p)&&roster.includes(String(p.email||'').toLowerCase())&&(p.role==='administrador_app'||rights.admin===true||rights.managementRead===true||rights.documentsManage===true);}).map(function(p){return p.uid;});
      if(!uids.includes(m.actorUid))throw Error('MANAGEMENT_EBOOK_AUDIENCE_INVALID');
      const state={code:'MANAGEMENT_EBOOK_RECOVERY',manifestDigest:formsEvaluationHash_(m),createdAt:new Date().toISOString(),index:0,runs:0,complete:false,backups:[],results:[],originalPolicy:policy,authorizedUids:uids};
      const f=DriveApp.createFile('SAHMT Gestão — recuperação da expansão dos e-books.json',JSON.stringify(state),MimeType.PLAIN_TEXT);f.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);mgePrivate_(f.getId());props.setProperty('SAHMT_MANAGEMENT_EBOOK_JOB',f.getId());
    }
  }finally{lock.releaseLock();}
  return continuarLeituraDocumentosGestaoFbV1();
}
function mgeBinding_(row,drive) {
  const binding=gqpConfig_(gqpResolvedConfig_()).bindings.find(function(b){return b.formId===row.formId;});
  if(!binding||binding.documentId!==row.bankFileId||binding.reviewFolderId!==row.reviewFolderId||binding.readingFolderId!==row.folderId)throw Error('MANAGEMENT_EBOOK_REVIEW_BINDING_CHANGED');
  drive.reviewFolder(row.reviewFolderId,row.folderId);
  [row.formId,row.pdfId,row.bankFileId].forEach(function(id){const meta=drive.metadata(id);if(meta.trashed||!(meta.parents||[]).includes(id===row.bankFileId?row.reviewFolderId:row.folderId))throw Error('MANAGEMENT_EBOOK_FILE_MOVED');});
  dgrPdf_({pdfId:row.pdfId,checksum:row.checksum},false);
  if(row.sourceId){
    const pair=gpdfConfig_().pairs.find(function(p){return p.pdfId===row.pdfId;}),baseline=pair&&gpdfLoad_(gpdfStateKey_(pair),null);
    if(!pair||pair.sourceId!==row.sourceId||pair.sourceFolderId!==row.reviewFolderId||pair.folderId!==row.folderId||!trainingMaterialPairStateValid_(pair,gpdfPair_(pair,drive),baseline))throw Error('MANAGEMENT_EBOOK_PDF_REVISION_PENDING');
  }
  return binding;
}
function mgeQuestionShape_(item){const q=item.questionItem.question;return {title:item.title||'',points:q.grading.pointValue,options:q.choiceQuestion.options.map(function(o){return {text:o.value,correct:q.grading.correctAnswers.answers.some(function(a){return a.value===o.value;})};})};}
function mgeBankProof_(row,metadata) {
  const scored=ropsScored_(metadata);if(scored.length<5)throw Error('MANAGEMENT_EBOOK_FIVE_QUESTIONS_REQUIRED');
  const blob=DriveApp.getFileById(row.bankFileId).getBlob(),tables=gqrRows_(blob),questions=[];let pending;
  tables.forEach(function(rows){
    if(rows[0]&&rows[0][0]==='Código da questão'){
      if(pending)throw Error('MANAGEMENT_EBOOK_BANK_INVALID');const field=function(n){const r=rows.find(function(x){return x[0]===n;});return r&&r[1];};pending={code:rows[0][1],title:field('Pergunta')||'',points:Number(field('Pontos'))};
    }else if(rows[0]&&['Opção|Texto|Gabarito','Alternativa|Texto|Gabarito'].includes(rows[0].join('|'))){
      if(!pending)throw Error('MANAGEMENT_EBOOK_BANK_INVALID');pending.options=rows.slice(1).map(function(r){const mark=dgrCategory_(r[2]);if(!['','CORRETA','RESPOSTA CORRETA'].includes(mark))throw Error('MANAGEMENT_EBOOK_BANK_INVALID');return {text:r[1],correct:Boolean(mark)};});questions.push(pending);pending=null;
    }
  });
  if(pending||new Set(questions.map(function(q){return q.code;})).size!==questions.length)throw Error('MANAGEMENT_EBOOK_BANK_INVALID');
  const codes={},seen=new Set();scored.forEach(function(item){
    const shape=mgeQuestionShape_(item),matches=questions.filter(function(q){return formsEvaluationHash_({title:q.title,points:q.points,options:q.options})===formsEvaluationHash_(shape);});
    if(matches.length!==1||seen.has(matches[0].code))throw Error('MANAGEMENT_EBOOK_BANK_CONTENT_CHANGED');seen.add(matches[0].code);codes[matches[0].code]=item.questionItem.question.questionId;
  });
  return {sha256:gqpBytesHash_(blob.getBytes()),codes:codes,keepQuestionIds:scored.slice(0,5).map(function(i){return i.questionItem.question.questionId;}),allBankCodes:questions.map(function(q){return q.code;})};
}
function mgeMapping_(metadata,previous) {
  const payload=previous?formsEvaluationMappingPayload_(previous):{modalities:{acknowledgement:true,suggestion:true,test:true}};
  if(!payload.acknowledgementItemId){const matches=(metadata.items||[]).filter(function(i){return /\[SAHMT:ACK\]|CI[ÊE]NCIA/i.test(i.title||'')&&i.questionItem&&i.questionItem.question.choiceQuestion;});if(matches.length!==1)throw Error('MANAGEMENT_EBOOK_ACK_REQUIRED');payload.acknowledgementItemId=matches[0].itemId;const answers=matches[0].questionItem.question.choiceQuestion.options.filter(function(o){return /^(sim\b|li e\b|declaro\b|estou ciente\b|ciente\b)/i.test(o.value);});if(answers.length!==1)throw Error('MANAGEMENT_EBOOK_ACK_REQUIRED');payload.acknowledgementValue=answers[0].value;}
  if(!payload.suggestionTextItemId&&!payload.suggestionProblemItemId){const matches=(metadata.items||[]).filter(function(i){return /\[SAHMT:SUGGESTION_TEXT\]|SUGEST[ÃAÕO]|CONTRIBUI[ÇC]/i.test(i.title||'')&&i.questionItem&&i.questionItem.question.textQuestion&&i.questionItem.question.textQuestion.paragraph;});if(matches.length!==1)throw Error('MANAGEMENT_EBOOK_SUGGESTION_REQUIRED');payload.suggestionTextItemId=matches[0].itemId;}
  payload.modalities={acknowledgement:true,suggestion:true,test:true};return payload;
}
function mgePrepareOne_(m,row,state,file) {
  const drive=gpdfDrive_(gpdfConfig_());mgeBinding_(row,drive);const form=FormApp.openById(row.formId),metadata=formsEvaluationMetadata_(row.formId);
  if(!form.supportsAdvancedResponderPermissions())throw Error('MANAGEMENT_EBOOK_FORM_UNSUPPORTED');
  let backup=state.backups.find(function(b){return b.formId===row.formId;});
  if(!backup){
    const previous=evaluationGet_('evaluationFormConfigs',row.formId),activity=evaluationGet_('evaluationActivities',row.formId);
    if((previous?previous.configVersion:0)!==row.expectedConfigVersion||!previous&&!formsEvaluationRepeatPolicy_(null))throw Error('MANAGEMENT_EBOOK_CONFIGURATION_CHANGED');
    const bank=mgeBankProof_(row,metadata),permissions=formsEvaluationPublishedPermissions_(row.formId);
    backup={formId:row.formId,metadata:metadata,bank:bank,permissions:permissions,normalFingerprint:dgrNormalFingerprint_(permissions),wasPublished:form.isPublished(),wasAccepting:form.isAcceptingResponses(),configuration:previous,activity:activity,documents:[evaluationGet_('scopedDocuments','evaluation_'+row.formId),evaluationGet_('scopedDocuments','pdf_evaluation_'+row.formId)]};
    backup.legacyDocuments=(row.legacyDocuments||[]).map(function(d){return evaluationGet_('documents',d.id);});state.backups.push(backup);file.setContent(JSON.stringify(state));
  }
  if(gqpBytesHash_(DriveApp.getFileById(row.bankFileId).getBlob().getBytes())!==backup.bank.sha256)throw Error('MANAGEMENT_EBOOK_BANK_CHANGED');
  const original=backup.metadata,keep=ropsScored_(original).slice(0,5),extra=new Set(ropsScored_(original).slice(5).map(function(i){return i.itemId;}));
  const materialIds=[row.pdfId,row.sourceId].filter(Boolean),materialLink=function(text){return materialIds.some(function(id){return String(text||'').includes('/d/'+id);});};
  const obsolete=/^(?:\d+[.)]\s*)?(MATERIAL DE APOIO|REVIS[ÃA]O PELO GESTOR)/i;
  const removeItem=function(i){return extra.has(i.itemId)||i.pageBreakItem||obsolete.test(String(i.title||'').trim())||!i.questionItem&&!i.questionGroupItem&&materialLink(String(i.title||'')+'\n'+String(i.description||''));};
  const expected=(original.items||[]).filter(function(i){return !removeItem(i);});
  const hash=function(items){return formsEvaluationHash_({formId:row.formId,items:items});};
  if(![hash(original.items),hash(expected)].includes(hash(metadata.items)))throw Error('MANAGEMENT_EBOOK_FORM_CHANGED');
  formsEvaluationCloseForm_(form);form.setLimitOneResponsePerUser(false);form.setAllowResponseEdits(false);
  // Native Form settings can change the API revision token. Re-read after
  // closing and changing those settings, then apply the content CAS once.
  const writable=formsEvaluationMetadata_(row.formId);if(hash(writable.items)!==hash(metadata.items))throw Error('MANAGEMENT_EBOOK_FORM_CHANGED_BEFORE_WRITE');
  const remove=(writable.items||[]).map(function(i,index){return {item:i,index:index};}).filter(function(x){return removeItem(x.item);});
  const requests=remove.sort(function(a,b){return b.index-a.index;}).map(function(x){return {deleteItem:{location:{index:x.index}}};});
  const description=String(writable.info&&writable.info.description||''),cleanDescription=description.split('\n').filter(function(line){return !materialLink(line)&&!obsolete.test(line.trim());}).join('\n').trim();
  if(description!==cleanDescription)requests.push({updateFormInfo:{info:{description:cleanDescription},updateMask:'description'}});
  if(requests.length)formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/'+row.formId+':batchUpdate',{method:'post',contentType:'application/json',payload:JSON.stringify({writeControl:{requiredRevisionId:writable.revisionId},requests:requests})});
  const live=formsEvaluationMetadata_(row.formId);if(ropsScored_(live).length!==5||formsEvaluationHash_(ropsScored_(live))!==formsEvaluationHash_(keep)||hash(live.items)!==hash(expected))throw Error('MANAGEMENT_EBOOK_FIRST_FIVE_CHANGED');
  const mapping=mgeMapping_(live,backup.configuration),checked=formsEvaluationConfiguration_(live,mapping),fingerprint=formsEvaluationMaterialFingerprint_([{contentHash:row.checksum}]);
  const prior=backup.configuration,changed=prior&&(formsEvaluationSavedQuestionFingerprint_(prior)!==checked.questionFingerprint||prior.materialFingerprint!==fingerprint||formsEvaluationHash_(prior.mapping)!==formsEvaluationHash_(checked.mapping));
  const version=prior?prior.version+(changed?1:0):1,digest=formsEvaluationHash_({formId:row.formId,questionFingerprint:checked.questionFingerprint,materialFingerprint:fingerprint,creditScopeId:row.creditScopeId,version:version});
  let cfg=evaluationGet_('evaluationFormConfigs',row.formId);
  if(!cfg||cfg.managementEbookManifestDigest!==state.manifestDigest){
    if((cfg?cfg.configVersion:0)!==(backup.expectedConfigurationVersion||row.expectedConfigVersion))throw Error('MANAGEMENT_EBOOK_CONFIGURATION_CHANGED');
    evaluationRunTransaction_(function(tx){mgeContext_(m,tx);const activity=evaluationGet_('evaluationActivities',row.formId,tx);return {writes:[evaluationWrite_('evaluationActivities',row.formId,{id:row.formId,formId:row.formId,title:row.title,active:true,areaIds:[m.managerAreaId],status:'CONFIGURATION_PENDING',trainingReleaseBlocked:true,trainingReleaseManifestDigest:state.manifestDigest,trainingReleaseDigest:digest,trainingReleaseClosedBaseline:true,sourceId:row.folderId,rootId:row.rootId},activity,['updatedAt'])],result:{}};});
    const payload=Object.assign({},mapping,{activityId:row.formId,creditScopeId:row.creditScopeId,version:version,expectedVersion:backup.expectedConfigurationVersion||row.expectedConfigVersion,eligibleUids:[],eligibleGroups:[row.audienceGroup],managerAreaId:m.managerAreaId,validFrom:Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd'),validUntil:m.validUntil,materialUrls:['https://drive.google.com/file/d/'+row.pdfId+'/view']});
    evaluationRunTransaction_(function(tx){mgeContext_(m,tx);const result=formsEvaluationConfigured_(payload,m.actorUid,tx,{kind:'MANAGEMENT_EBOOK_RECONCILIATION',manifestDigest:state.manifestDigest});result.writes.forEach(function(w){w.update.fields.managementEbookManifestDigest={stringValue:state.manifestDigest};if(w.updateMask&&!w.updateMask.fieldPaths.includes('managementEbookManifestDigest'))w.updateMask.fieldPaths.push('managementEbookManifestDigest');});return result;});
    cfg=evaluationGet_('evaluationFormConfigs',row.formId);
  }
  if(cfg.materialFingerprint!==fingerprint||formsEvaluationSavedQuestionFingerprint_(cfg)!==checked.questionFingerprint||cfg.version!==version||cfg.trainingRevisionRequired===true)throw Error('MANAGEMENT_EBOOK_CONFIGURATION_POSTCHECK');
  const permissions=formsEvaluationPublishedPermissions_(row.formId);if(dgrNormalFingerprint_(permissions)!==backup.normalFingerprint)throw Error('MANAGEMENT_EBOOK_EDITORS_CHANGED');dgrRemovePublished_(row.formId,permissions);
  form.setPublished(true);form.setAcceptingResponses(true);
  if(!form.isPublished()||!form.isAcceptingResponses()||formsEvaluationPublishedPermissions_(row.formId).some(function(p){return p.view==='published';}))throw Error('MANAGEMENT_EBOOK_RESPONDER_ACCESS_CHANGED');
  const proof={formId:row.formId,manifestDigest:state.manifestDigest,formDigest:digest,version:version,questionFingerprint:checked.questionFingerprint,materialFingerprint:fingerprint,bankSha256:backup.bank.sha256,questionCodeMap:backup.bank.codes,keepQuestionIds:backup.bank.keepQuestionIds,allBankCodes:backup.bank.allBankCodes};
  const previousResult=state.results.findIndex(function(r){return r.formId===row.formId;});if(previousResult<0)state.results.push(proof);else state.results[previousResult]=proof;file.setContent(JSON.stringify(state));
  // Merge the latest policy so unrelated ROP receipts and concurrent entries survive.
  const props=gpdfProps_(),policy=dgrPolicy_(),id='evaluation_'+row.formId,old=policy.documents[id];
  if(old&&(old.formId!==row.formId||old.pdfId!==row.pdfId||old.checksum!==row.checksum))throw Error('MANAGEMENT_EBOOK_POLICY_CHANGED');
  policy.documents[id]=Object.assign({},old||{},{formId:row.formId,pdfId:row.pdfId,checksum:row.checksum,pages:row.pages,version:version,enforced:true,category:row.category,audienceGroup:row.audienceGroup,pdfDocumentId:'pdf_evaluation_'+row.formId},row.sourceId?{sourceFileId:row.sourceId}:{});
  policy.pilotUids=[...new Set(policy.pilotUids.concat(state.authorizedUids))];dgrStorePolicy_(policy);props.setProperty('SAHMT_READING_CUTOVER_SHA256',formsEvaluationHash_(policy.documents));
  evaluationRunTransaction_(function(tx){
    mgeContext_(m,tx);const current=evaluationGet_('evaluationFormConfigs',row.formId,tx),activity=evaluationGet_('evaluationActivities',row.formId,tx);if(!current||current.configVersion!==cfg.configVersion||activity.trainingReleaseDigest!==digest)throw Error('MANAGEMENT_EBOOK_READY_CONFLICT');
    const ready={status:'READY',reason:'',publicationPending:false,trainingReleaseBlocked:false,repeatPolicy:'FIRST_RESPONSE_PER_VERSION',managementEbookManifestDigest:state.manifestDigest};
    const writes=[evaluationWrite_('evaluationFormConfigs',row.formId,ready,current,['updatedAt','accessVerifiedAt']),evaluationWrite_('evaluationActivities',row.formId,ready,activity,['updatedAt','accessVerifiedAt'])];
    [['evaluation_'+row.formId,row.formId,cfg.responderUrl],['pdf_evaluation_'+row.formId,row.pdfId,'https://drive.google.com/file/d/'+row.pdfId+'/view']].forEach(function(parts){const doc=evaluationGet_('scopedDocuments',parts[0],tx);if(doc&&doc.audienceGroup&&doc.audienceGroup!==row.audienceGroup)throw Error('MANAGEMENT_EBOOK_AUDIENCE_CHANGED');const patch={id:parts[0],managementAreaId:m.managerAreaId,title:row.title,category:row.category,audienceGroup:row.audienceGroup,description:'Leitura do material, ciência, avaliação de cinco questões e sugestões.',requiredReading:true,active:true,readingGateRequired:true,driveFileId:parts[1],driveUrl:parts[2],version:doc?doc.version+1:1,updatedByUid:m.actorUid};if(!doc)patch.createdByUid=m.actorUid;writes.push(evaluationWrite_('scopedDocuments',parts[0],patch,doc,doc?['updatedAt']:['createdAt','updatedAt','publishedAt']));});
    (row.legacyDocuments||[]).forEach(function(d){const old=evaluationGet_('documents',d.id,tx);if(!old||old.driveFileId!==d.driveFileId||!/^Organograma$/i.test(old.title||'')||!/^ORGANOGRAMA$/i.test(row.title))throw Error('MANAGEMENT_EBOOK_LEGACY_CHANGED');if(old.active)writes.push(evaluationWrite_('documents',d.id,{active:false,replacedBy:'scopedDocuments/evaluation_'+row.formId,updatedByUid:m.actorUid},old,['updatedAt']));});
    const alias=formsEvaluationLink_(cfg.responderUrl);if(!alias)throw Error('MANAGEMENT_EBOOK_FORM_URL_INVALID');const linkId='link-'+formsEvaluationHash_('scopedDocuments\u0000evaluation_'+row.formId+'\u0000'+alias.aliasKey),link=evaluationGet_('evaluationLinks',linkId,tx);writes.push(evaluationWrite_('evaluationLinks',linkId,{id:linkId,sourceCollection:'scopedDocuments',sourceId:'evaluation_'+row.formId,sourceVersion:version,areaIds:[m.managerAreaId],aliasKey:alias.aliasKey,normalizedUrl:alias.normalizedUrl,formId:row.formId,active:true,status:'READY',reason:'Liberação individual após leitura.'},link,['updatedAt']));return {writes:writes,result:{}};
  });
  dgrCatalog_(id,policy.documents[id]);mgeTrainingReleaseVerify_(row.formId);return proof;
}
function continuarLeituraDocumentosGestaoFbV1() {
  ropsOwner_();evaluationAssertOperator_(true);const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'MANAGEMENT_EBOOK_BUSY'};
  let current;
  try{
    const m=mgeManifest_(),file=mgePrivate_(gpdfProps_().getProperty('SAHMT_MANAGEMENT_EBOOK_JOB')),state=JSON.parse(file.getBlob().getDataAsString('UTF-8'));mgeContext_(m,null);
    if(state.manifestDigest!==formsEvaluationHash_(m)||!Number.isInteger(state.index)||state.index<0||state.index>m.items.length||Date.now()-Date.parse(state.createdAt)>7*86400000||++state.runs>70)throw Error('MANAGEMENT_EBOOK_STATE_INVALID');
    if(!state.complete){const began=Date.now();for(let n=0;state.index<m.items.length&&n<2&&Date.now()-began<145000;state.index++,n++){const row=m.items[state.index];current=FormApp.openById(row.formId);mgePrepareOne_(m,row,state,file);current=null;file.setContent(JSON.stringify(state));}}
    state.complete=state.index===m.items.length;file.setContent(JSON.stringify(state));mgeStopTrigger_();if(!state.complete)mgeArm_();
    const result={code:state.complete?'MANAGEMENT_EBOOK_TRAININGS_ACTIVE':'MANAGEMENT_EBOOK_PROGRESS',completed:state.index,total:m.items.length,privateRecoveryUrl:file.getUrl(),automaticContinuation:!state.complete,projectId:evaluationProject_(),preservedRops:state.originalPolicy.documents?Object.keys(state.originalPolicy.documents).length:0};console.log(JSON.stringify(result));return result;
  }catch(e){mgeStopTrigger_();if(current)try{formsEvaluationCloseForm_(current);}catch(_){}throw e;}finally{lock.releaseLock();}
}
function mgeSaved_(){const id=gpdfProps_().getProperty('SAHMT_MANAGEMENT_EBOOK_JOB');if(!id)return null;const m=mgeManifest_(),state=JSON.parse(mgePrivate_(id).getBlob().getDataAsString('UTF-8'));if(state.manifestDigest!==formsEvaluationHash_(m))throw Error('MANAGEMENT_EBOOK_MANIFEST_CHANGED');return state;}
function mgeRepeatSetup_(payload,actorUid,tx,setup) {
  if(!tx||!setup||setup.kind!=='MANAGEMENT_EBOOK_RECONCILIATION')throw Error('MANAGEMENT_EBOOK_REPEAT_SETUP_DENIED');
  const m=mgeManifest_(),state=mgeSaved_(),row=m.items.find(function(r){return r.formId===payload.activityId;});
  if(!state||state.complete||state.manifestDigest!==setup.manifestDigest||actorUid!==m.actorUid||!row||m.items[state.index].formId!==row.formId||payload.creditScopeId!==row.creditScopeId||payload.managerAreaId!==m.managerAreaId||!state.backups.some(function(b){return b.formId===row.formId;})||formsEvaluationHash_(payload.eligibleGroups)!==formsEvaluationHash_([row.audienceGroup])||payload.eligibleUids.length)throw Error('MANAGEMENT_EBOOK_REPEAT_SETUP_DENIED');
  mgeContext_(m,tx);const form=FormApp.openById(row.formId);
  if(form.isAcceptingResponses()||form.isPublished()||form.canEditResponse()||form.hasLimitOneResponsePerUser())throw Error('MANAGEMENT_EBOOK_REPEAT_FORM_NOT_CLOSED');
  return true;
}
function mgeTrainingReleaseVerify_(formId) {
  if(typeof mgeTrustedManifest_!=='function')return null;const row=mgeManifest_().items.find(function(r){return r.formId===formId;});if(!row)return null;const state=mgeSaved_();if(!state)return null;
  const proof=state.results.find(function(r){return r.formId===formId;});if(!proof)throw Error('MANAGEMENT_EBOOK_PUBLICATION_PENDING');const m=mgeManifest_();mgeContext_(m,null);
  const metadata=formsEvaluationMetadata_(formId),cfg=evaluationGet_('evaluationFormConfigs',formId),activity=evaluationGet_('evaluationActivities',formId);dgrPdf_({pdfId:row.pdfId,checksum:row.checksum},false);
  if(!cfg||!activity||cfg.version!==proof.version||cfg.creditScopeId!==row.creditScopeId||cfg.configuredByUid!==m.actorUid||cfg.materialFingerprint!==proof.materialFingerprint||formsEvaluationSavedQuestionFingerprint_(cfg)!==proof.questionFingerprint||formsEvaluationQuestionFingerprint_(formsEvaluationQuestionSnapshot_(metadata))!==proof.questionFingerprint||ropsScored_(metadata).length!==5||activity.trainingReleaseManifestDigest!==proof.manifestDigest||activity.trainingReleaseDigest!==proof.formDigest||activity.trainingReleaseClosedBaseline!==true||formsEvaluationHash_(cfg.eligibleGroups)!==formsEvaluationHash_([row.audienceGroup])||cfg.eligibleUids.length)throw Error('MANAGEMENT_EBOOK_PUBLICATION_CHANGED');return {formId:formId,manifestDigest:proof.manifestDigest,formDigest:proof.formDigest};
}
function mgeQuestionChoices_(form,choices){if(typeof mgeTrustedManifest_!=='function'||!mgeManifest_().items.some(function(r){return r.formId===form.formId;}))return choices;const scored=choices.filter(function(i){return Number(i.questionItem.question.grading&&i.questionItem.question.grading.pointValue)>0;});if(scored.length!==5)throw Error('MANAGEMENT_EBOOK_FIVE_QUESTIONS_REQUIRED');return scored;}
function mgeQuestionTables_(form,tables) {
  if(typeof mgeTrustedManifest_!=='function'||!mgeManifest_().items.some(function(r){return r.formId===form.formId;}))return tables;
  const state=mgeSaved_(),proof=state&&state.results.find(function(r){return r.formId===form.formId;});if(!proof)throw Error('MANAGEMENT_EBOOK_REVIEW_NOT_READY');
  const wanted=new Set(proof.keepQuestionIds),out=[];let include=false;
  tables.forEach(function(rows){if(rows[0]&&rows[0][0]==='Código da questão'){const code=rows[0][1];if(!proof.allBankCodes.includes(code))throw Error('MANAGEMENT_EBOOK_QUESTION_CODE_CHANGED');const id=proof.questionCodeMap[code];include=wanted.has(id);if(include){const copy=JSON.parse(JSON.stringify(rows));copy[0][1]=id;out.push(copy);}}else if(include)out.push(rows);});return out;
}
