// Owner-only material setup. No browser-supplied IDs and no Firestore calls.
function ropsMaterialManifest_() {
  ropsOwner_();const cfg=ropsMaterialSetupConfig_(),file=DriveApp.getFileById(cfg.manifestId);
  if(file.isTrashed()||file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('ROPS_MATERIAL_MANIFEST_NOT_PRIVATE');
  const raw=file.getBlob().getDataAsString('UTF-8');if(formsEvaluationHash_(raw)!==cfg.manifestSha256)throw Error('ROPS_MATERIAL_MANIFEST_CHANGED');
  const manifest=JSON.parse(raw),ids=new Set();
  if(manifest.code!=='ROPS_MATERIAL_SETUP_MANIFEST'||manifest.items.length!==20)throw Error('ROPS_MATERIAL_MANIFEST_INVALID');
  manifest.items.forEach(function(row){['formId','folderId','reviewFolderId','sourceId','pdfId','bankFileId'].forEach(function(key){if(!/^[A-Za-z0-9_-]{10,200}$/.test(row[key]||''))throw Error('ROPS_MATERIAL_BINDING_INVALID');});
    if(ids.has(row.sourceId)||ids.has(row.pdfId)||row.sourceId===row.pdfId||!Number.isInteger(row.pages)||row.pages<1||row.pages>300||!/^[a-f0-9]{64}$/.test(row.sourceSha256)||!/^[a-f0-9]{64}$/.test(row.pdfSha256)||!/^[a-f0-9]{32}$/.test(row.pdfMd5))throw Error('ROPS_MATERIAL_BINDING_INVALID');ids.add(row.sourceId);ids.add(row.pdfId);});
  return {cfg:cfg,items:manifest.items};
}
function ropsPdfPairs_() {
  const raw=gpdfProps_().getProperty('SAHMT_ROPS_PDF_PAIRS');if(!raw)return [];
  const stored=JSON.parse(raw),manifest=ropsMaterialManifest_();
  const expected=manifest.items.map(function(row){return {sourceId:row.sourceId,pdfId:row.pdfId,folderId:row.folderId,sourceFolderId:row.reviewFolderId};});
  if(!stored||stored.manifestSha256!==manifest.cfg.manifestSha256||JSON.stringify(stored.pairs)!==JSON.stringify(expected))throw Error('ROPS_PDF_BINDINGS_CHANGED');
  return expected;
}
function ropsQuestionChoices_(form,choices) {
  if(!gpdfProps_().getProperty('SAHMT_ROPS_PDF_PAIRS'))return choices;
  if(!ropsMaterialManifest_().items.some(function(row){return row.formId===form.formId;}))return choices;
  const scored=choices.filter(function(item){return Number(item.questionItem.question.grading&&item.questionItem.question.grading.pointValue)>0;});
  if(scored.length!==5)throw Error('ROPS_FIVE_QUESTIONS_REQUIRED');return scored;
}
function ropsQuestionBindings_(cfg) {
  if(!gpdfProps_().getProperty('SAHMT_ROPS_PDF_PAIRS'))return cfg;
  const manifest=ropsMaterialManifest_(),ids=new Set(manifest.items.map(function(row){return row.formId;}));
  const bindings=cfg.bindings.filter(function(row){return !ids.has(row.formId);}).concat(manifest.items.map(function(row){
    const previous=cfg.bindings.find(function(binding){return binding.formId===row.formId;});
    return {formId:row.formId,documentId:row.bankFileId,reviewFolderId:row.reviewFolderId,readingFolderId:row.folderId,assignment:previous&&previous.assignment||null};
  }));return Object.assign({},cfg,{bindings:bindings});
}
function ropsQueueMaterials_() {
  const pairs=ropsPdfPairs_(),queue=gpdfLoad_('SAHMT_DOCUMENT_PDF_QUEUE',[]);if(!Array.isArray(queue))throw Error('ROPS_PDF_QUEUE_INVALID');
  pairs.forEach(function(pair){if(!queue.includes(pair.sourceId))queue.push(pair.sourceId);});gpdfSave_('SAHMT_DOCUMENT_PDF_QUEUE',queue);
}
function ropsMaterialMove_(id,folderId,stagingFolderId,mime,digest) {
  const base='https://www.googleapis.com/drive/v3/files/',before=gpdfJson_(base+id+'?fields=id,mimeType,parents,trashed');
  if(before.trashed||before.mimeType!==mime||gvrDigest_(DriveApp.getFileById(id).getBlob().getBytes())!==digest)throw Error('ROPS_MATERIAL_CHANGED');
  if(!(before.parents||[]).includes(folderId)){
    if((before.parents||[]).length!==1||before.parents[0]!==stagingFolderId)throw Error('ROPS_MATERIAL_PARENT_CHANGED');
    gpdfJson_(base+id+'?addParents='+folderId+'&removeParents='+stagingFolderId+'&fields=id,parents',{method:'patch',contentType:'application/json',payload:'{}'});
  }
  const after=gpdfJson_(base+id+'?fields=id,parents');if(!(after.parents||[]).includes(folderId))throw Error('ROPS_MATERIAL_MOVE_UNCONFIRMED');
}
function ropsMaterialTrigger_() {
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='continuarMateriaisRopsFbV1';}).forEach(function(t){ScriptApp.deleteTrigger(t);});
}
function instalarMateriaisRopsFbV1() {
  ropsOwner_();if(String(Session.getActiveUser().getEmail()||'').toLowerCase()!=='anestesiahmtforms@gmail.com')throw Error('ROPS_OPERATOR_DENIED');
  const manifest=ropsMaterialManifest_(),props=gpdfProps_();
  if(!props.getProperty('SAHMT_ROPS_MATERIAL_JOB')){
    const record={code:'ROPS_MATERIAL_RECOVERY',manifestSha256:manifest.cfg.manifestSha256,createdAt:new Date().toISOString(),index:0,results:[],runs:0};
    const file=DriveApp.createFile('SAHMT ROPs — recuperação dos materiais.json',JSON.stringify(record),MimeType.PLAIN_TEXT);props.setProperty('SAHMT_ROPS_MATERIAL_JOB',file.getId());
  }
  return continuarMateriaisRopsFbV1();
}
function continuarMateriaisRopsFbV1() {
  ropsOwner_();const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'ROPS_MATERIAL_BUSY'};
  try{
    const manifest=ropsMaterialManifest_(),props=gpdfProps_(),file=DriveApp.getFileById(props.getProperty('SAHMT_ROPS_MATERIAL_JOB'));
    if(file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('ROPS_MATERIAL_RECOVERY_NOT_PRIVATE');
    const state=JSON.parse(file.getBlob().getDataAsString('UTF-8'));if(state.manifestSha256!==manifest.cfg.manifestSha256||!Number.isInteger(state.index)||state.index<0||state.index>20||Date.now()-Date.parse(state.createdAt)>86400000||!Array.isArray(state.results)||++state.runs>20)throw Error('ROPS_MATERIAL_STATE_INVALID');
    file.setContent(JSON.stringify(state));const started=Date.now(),original=gpdfConfig_(),drive=gpdfDrive_(original);drive.workspace();
    for(let count=0;state.index<20&&count<3&&Date.now()-started<150000;state.index++,count++){
      const row=manifest.items[state.index];drive.reviewFolder(row.reviewFolderId,row.folderId);
      const bank=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+row.bankFileId+'?fields=id,parents,trashed');if(bank.trashed||!(bank.parents||[]).includes(row.reviewFolderId))throw Error('ROPS_BANK_BINDING_CHANGED');
      ropsMaterialMove_(row.sourceId,row.reviewFolderId,manifest.cfg.stagingFolderId,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',row.sourceSha256);
      ropsMaterialMove_(row.pdfId,row.folderId,manifest.cfg.stagingFolderId,'application/pdf',row.pdfSha256);
      const pair={sourceId:row.sourceId,pdfId:row.pdfId,folderId:row.folderId,sourceFolderId:row.reviewFolderId},snapshot=gpdfPair_(pair,drive),key=gpdfStateKey_(pair),baseline=gpdfLoad_(key,null);
      if(snapshot.pdf.md5Checksum!==row.pdfMd5)throw Error('ROPS_MATERIAL_PDF_CHANGED');
      if(baseline&&baseline.sourceId!==row.sourceId)throw Error('ROPS_PDF_BASELINE_CHANGED');
      if(!baseline)gpdfSave_(key,{sourceId:row.sourceId,sourceStamp:gpdfStamp_(snapshot.source),pdfMd5:snapshot.pdf.md5Checksum,pending:null});
      if(!state.results.some(function(r){return r.formId===row.formId;}))state.results.push({formId:row.formId,sourceId:row.sourceId,pdfId:row.pdfId,reviewFolderId:row.reviewFolderId,baselineVerified:true});
      file.setContent(JSON.stringify(state));
    }
    file.setContent(JSON.stringify(state));ropsMaterialTrigger_();const complete=state.index===20;
    if(complete){
      const pairs=manifest.items.map(function(row){return {sourceId:row.sourceId,pdfId:row.pdfId,folderId:row.folderId,sourceFolderId:row.reviewFolderId};});
      const old=props.getProperty('SAHMT_ROPS_PDF_PAIRS'),raw=JSON.stringify({manifestSha256:manifest.cfg.manifestSha256,pairs:pairs});if(old&&old!==raw)throw Error('ROPS_PDF_CONFIG_CONFLICT');
      // All new bindings and baselines are durable before the existing trigger can see them.
      props.setProperty('SAHMT_ROPS_PDF_PAIRS',raw);const cfg=gpdfConfig_();if(cfg.pairs.length!==original.pairs.length+(old?0:20))throw Error('ROPS_PDF_CONFIG_POSTCHECK');
      ropsQueueMaterials_();
      if(!props.getProperty('SAHMT_DOCUMENT_PDF_CURSOR'))props.setProperty('SAHMT_DOCUMENT_PDF_CURSOR',drive.start());
      const triggers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='atualizarPdfsGestaoAlteradosV1';});
      if(!triggers.length)ScriptApp.newTrigger('atualizarPdfsGestaoAlteradosV1').timeBased().everyMinutes(5).create();triggers.slice(1).forEach(function(t){ScriptApp.deleteTrigger(t);});props.setProperty('SAHMT_DOCUMENT_PDF_SYNC_ENABLED','YES');
    }else ScriptApp.newTrigger('continuarMateriaisRopsFbV1').timeBased().after(60000).create();
    const result={code:complete?'ROPS_MATERIALS_INSTALLED':'ROPS_MATERIAL_PROGRESS',completed:state.index,total:20,privateRecoveryUrl:file.getUrl(),automaticContinuation:!complete,firestoreReads:0,firestoreWrites:0,formsRemainClosed:true};console.log(JSON.stringify(result));return result;
  }catch(error){ropsMaterialTrigger_();throw error;}finally{lock.releaseLock();}
}
