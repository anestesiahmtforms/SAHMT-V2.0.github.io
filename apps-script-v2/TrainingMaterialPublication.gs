// Resolves ONLY server-owned DOC -> PDF bindings. No ACL mutation or public fallback.
function trainingMaterialPairStateValid_(pair,current,state) {
  return Boolean(pair && current && state && state.sourceId===pair.sourceId && !state.pending && state.readingRevalidationRequired!==true &&
    state.sourceStamp===gpdfStamp_(current.source) && /^[a-f0-9]{32}$/.test(state.pdfMd5||'') && state.pdfMd5===current.pdf.md5Checksum);
}
function trainingReleaseReadingEntry_(entry,audience,pdfConfig,pdfDrive) {
  if(!pdfConfig)return entry;
  const matches=pdfConfig.pairs.filter(function(pair){return pair.sourceId===entry.id;});
  if(!matches.length)return entry;
  if(matches.length!==1 || matches[0].sourceId===matches[0].pdfId)trainingReleaseReject_('MATERIAL_PDF_BINDING_AMBIGUOUS');
  const pair=matches[0],current=gpdfPair_(pair,pdfDrive),state=gpdfLoad_(gpdfStateKey_(pair),null);
  if(!trainingMaterialPairStateValid_(pair,current,state))trainingReleaseReject_('MATERIAL_PDF_REVISION_PENDING');
  const original=DriveApp.getFileById(pair.sourceId);
  if(original.isTrashed() || String(original.getOwner().getEmail()||'').trim().toLowerCase()!==audience.owner)trainingReleaseReject_('MATERIAL_SOURCE_OWNER_CHANGED');
  return {id:pair.pdfId,group:entry.group,rop:false};
}
function trainingMaterialFormLinkMatches_(metadata,sourceId,pdfId) {
  if(!metadata || !/^[A-Za-z0-9_-]+$/.test(sourceId)||!/^[A-Za-z0-9_-]+$/.test(pdfId))return false;
  const source=new RegExp('https://(?:docs|drive)\\.google\\.com/(?:document|file)/d/'+sourceId+'(?:[/\\s?#]|$)');
  const pdf=new RegExp('https://drive\\.google\\.com/file/d/'+pdfId+'/(?:view|preview)(?:[\\s?#]|$)');
  const strings=[metadata.info && metadata.info.description || ''];
  (metadata.items||[]).forEach(function(item){strings.push(String(item.title||''),String(item.description||''));});
  return !strings.some(function(value){return source.test(value);}) && (metadata.items||[]).some(function(item){return item.textItem && /material de apoio/i.test(String(item.title||'')) && pdf.test(String(item.description||''));});
}
function trainingReleasePdfAccessExact_(entry,file,permissions,audience,requireCompleteRoster) {
  const expected=new Set(audience.groups[entry.group].concat([audience.owner,audience.writer])),seen=new Set();
  for(let i=0;i<permissions.length;i++){
    const p=permissions[i],email=String(p.emailAddress||'').trim().toLowerCase();
    if(p.type!=='user'||!formsEvaluationId_(p.id)||!expected.has(email)||seen.has(email)||p.deleted===true||p.pendingOwner===true||p.expirationTime||p.view)return false;
    if(email===audience.owner){if(p.role!=='owner'||p.id!==file.owners[0].permissionId)return false;}
    else if(p.role!=='reader' && !(email===audience.writer&&p.role==='writer'))return false;
    seen.add(email);
  }
  return seen.has(audience.owner) && (requireCompleteRoster===false || seen.size===expected.size);
}
function trainingReleaseQuestionBankPrivate_(loaded,formId) {
  if(typeof gqpTrustedConfig_!=='function'||typeof gqpConfig_!=='function')trainingReleaseReject_('MATERIAL_REVIEW_PROOF_REQUIRED');
  const cfg=gqpConfig_(gqpTrustedConfig_()),binding=cfg.bindings.find(function(row){return row.formId===formId;});
  if(!binding||cfg.operatorEmail!==loaded.operator)trainingReleaseReject_('MATERIAL_REVIEW_BINDING_REQUIRED');
  const allowed=new Set([loaded.operator]);
  (cfg.administratorEditorEmails||[]).forEach(function(email){
    if(email===loaded.operator)return;
    const profiles=formsEvaluationAll_('users').filter(function(profile){return String(profile.email||'').trim().toLowerCase()===email;});
    if(profiles.length!==1||!profiles[0].uid||profiles[0].id!==profiles[0].uid||!formsEvaluationAdmin_(profiles[0]))trainingReleaseReject_('MATERIAL_REVIEW_ADMIN_REVOKED');allowed.add(email);
  });
  if(binding.assignment){
    const config=evaluationGet_('evaluationFormConfigs',formId),assignment=config&&evaluationGet_('evaluationAssignments',config.assignmentId),profile=evaluationGet_('users',binding.assignment.uid);
    if(!config||!assignment||assignment.uid!==binding.assignment.uid||assignment.version!==binding.assignment.version||config.managerUid!==assignment.uid||config.assignmentVersion!==assignment.version||!formsEvaluationActive_(profile)||profile.uid!==binding.assignment.uid||profile.id!==binding.assignment.uid)trainingReleaseReject_('MATERIAL_REVIEW_MANAGER_REVOKED');
    allowed.add(String(profile.email||'').trim().toLowerCase());
  }
  [binding.reviewFolderId,binding.documentId].forEach(function(id,index){
    const meta=formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,mimeType,parents,trashed,owners(emailAddress,permissionId),inheritedPermissionsDisabled');
    if(meta.id!==id||meta.trashed||!Array.isArray(meta.owners)||meta.owners.length!==1||meta.owners[0].emailAddress!==loaded.operator||
      !(meta.parents||[]).includes(index===0?binding.readingFolderId:binding.reviewFolderId)||
      (index===0?(meta.mimeType!=='application/vnd.google-apps.folder'||meta.inheritedPermissionsDisabled!==true):!['application/vnd.google-apps.document','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(meta.mimeType)))trainingReleaseReject_('MATERIAL_REVIEW_LOCATION_CHANGED');
    const effective=trainingReleaseMaterialPermissions_(id).filter(function(p){return p.view!=='metadata';});let owner=0;
    effective.forEach(function(p){const email=String(p.emailAddress||'').trim().toLowerCase();if(p.type!=='user'||!allowed.has(email)||!['owner','writer'].includes(p.role)||p.view||p.deleted||p.pendingOwner||p.expirationTime)trainingReleaseReject_('MATERIAL_REVIEW_ACCESS_CHANGED');if(p.role==='owner'){if(email!==loaded.operator||p.id!==meta.owners[0].permissionId)trainingReleaseReject_('MATERIAL_REVIEW_OWNER_CHANGED');owner++;}});
    if(owner!==1)trainingReleaseReject_('MATERIAL_REVIEW_OWNER_CHANGED');
  });return true;
}
function trainingReleaseReviewedCloneAccess_(loaded,item) {
  try{return trainingReleaseCloneAccess_(loaded);}catch(error){if(error.trainingReleaseCode!=='CLONE_FOLDER_READERS')throw error;}
  trainingReleaseQuestionBankPrivate_(loaded,item.formId);
  const id=SAHMT_V2_TRAINING_RELEASE.cloneRootId,meta=formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,mimeType,parents,trashed,owners(emailAddress,permissionId),inheritedPermissionsDisabled');
  if(meta.id!==id||meta.mimeType!=='application/vnd.google-apps.folder'||meta.trashed||meta.inheritedPermissionsDisabled!==true||!Array.isArray(meta.parents)||meta.parents.length!==1||meta.parents[0]!==SAHMT_V2_TRAINING_RELEASE.outsideCloneParentId||!meta.owners||meta.owners.length!==1||meta.owners[0].emailAddress!==loaded.operator)trainingReleaseReject_('CLONE_ACCESS_PENDING');
  const permissions=trainingReleaseMaterialPermissions_(id),audience=trainingReleaseMaterialAudience_(loaded);
  permissions.filter(function(p){return p.view;}).forEach(function(p){if(p.view!=='metadata'||p.role!=='reader'||p.inheritedPermissionsDisabled!==true||p.deleted||p.pendingOwner||!(p.permissionDetails||[]).length||!p.permissionDetails.every(function(d){return d.inherited===true;}))trainingReleaseReject_('CLONE_FOLDER_READERS');});
  // The parent may have fewer readers than its individually shared PDFs; never more.
  if(!trainingReleasePdfAccessExact_({group:'GENERAL'},meta,permissions.filter(function(p){return !p.view;}),audience,false))trainingReleaseReject_('CLONE_FOLDER_READERS');return true;
}
