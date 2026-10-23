// Owner-approved question publication. No watcher, client endpoint, scoring or automatic reopening.
function gqpFail_(code) { throw Error('QUESTION_PUBLICATION_' + code); }
function gqpHash_(value) { return formsEvaluationHash_(value); }
function gqpBytesHash_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function(b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}
function gqpContent_(form) {
  // revisionId is an opaque CAS token, not a content version. Audience remains outside the patch.
  const items=JSON.parse(JSON.stringify(form.items || []));
  items.forEach(function(i) {
    i.title=i.title || '';i.description=i.description || '';
    const q=i.questionItem && i.questionItem.question;
    if(q) { q.required=q.required === true;if(q.choiceQuestion)q.grading=Object.assign({},q.grading,{pointValue:q.grading && q.grading.pointValue || 0}); }
  });
  return {formId:form.formId, info:form.info || {}, settings:form.settings || {}, items:items, linkedSheetId:form.linkedSheetId || ''};
}
function gqpChoices_(form) {
  const choices=(form.items || []).filter(function(i) { const c=i.questionItem && i.questionItem.question && i.questionItem.question.choiceQuestion;return c && Array.isArray(c.options) && c.options.length >= 2; });
  const selected=typeof ropsQuestionChoices_==='function'?ropsQuestionChoices_(form,choices):choices;
  return typeof mgeQuestionChoices_==='function'?mgeQuestionChoices_(form,selected):selected;
}
function gqpResolvedConfig_() {
  const cfg=gqpTrustedConfig_();return typeof ropsQuestionBindings_==='function'?ropsQuestionBindings_(cfg):cfg;
}
function gqpModel_(form) {
  const items=gqpChoices_(form);
  if(!form || !form.formId || !form.revisionId || !items.length)gqpFail_('FORM_INVALID');
  return {formId:form.formId, bankSha256:gqeHash_(items), questions:items.map(function(i) {
    const q=i.questionItem.question, c=q.choiceQuestion, answers=q.grading && q.grading.correctAnswers && q.grading.correctAnswers.answers || [];
    if(!i.itemId || !q.questionId || !['RADIO','CHECKBOX','DROP_DOWN'].includes(c.type) || i.questionItem.image || c.options.some(function(o) { return o.image || o.isOther || o.goToSectionId || o.goToAction; }))gqpFail_('UNSUPPORTED_QUESTION');
    return {itemId:i.itemId, questionId:q.questionId, title:i.title || '', description:i.description || '', type:c.type,
      points:q.grading && q.grading.pointValue || 0, required:q.required === true,
      options:c.options.map(function(o,n) { return {label:String.fromCharCode(65+n),text:o.value,correct:answers.some(function(a) { return a.value === o.value; })}; })};
  })};
}
function gqpPlan_(form, edited) {
  const model=gqpModel_(form), requests=[], target=JSON.parse(JSON.stringify(form));
  // Reuse the validated content, answer-key and fixed-point checks.
  gqrPlan_(model, {formId:form.formId,items:gqpChoices_(form)}, edited);
  model.questions.forEach(function(before) {
    const next=edited.questions.find(function(q) { return q.questionId === before.questionId; });
    if(before.title === next.title && before.description === next.description && before.options.every(function(o,n) { return o.text === next.options[n].text && o.correct === next.options[n].correct; }))return;
    const index=form.items.findIndex(function(i) { return i.itemId === before.itemId; }), item=target.items[index], question=item.questionItem.question;
    item.title=next.title; item.description=next.description;
    question.choiceQuestion.options=question.choiceQuestion.options.map(function(o,n) { return Object.assign({},o,{value:next.options[n].text}); });
    question.grading=Object.assign({},question.grading,{correctAnswers:{answers:next.options.filter(function(o) { return o.correct; }).map(function(o) { return {value:o.text}; })}});
    requests.push({updateItem:{item:item,location:{index:index},updateMask:'title,description,questionItem.question.choiceQuestion.options,questionItem.question.grading.correctAnswers'}});
  });
  return {requests:requests,target:target};
}
function gqpConfig_(cfg) {
  const id=/^[A-Za-z0-9_-]{10,200}$/;
  if(!cfg || cfg.version !== 1 || typeof cfg.enabled !== 'boolean' || typeof cfg.operatorEmail !== 'string' || !cfg.operatorEmail.includes('@') || !Array.isArray(cfg.bindings) || !cfg.bindings.length || cfg.bindings.length > 150)gqpFail_('CONFIG_INVALID');
  const forms=new Set(), docs=new Set();
  if(cfg.apiQuotaProjectId !== undefined && !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(cfg.apiQuotaProjectId))gqpFail_('CONFIG_INVALID');
  if(!Array.isArray(cfg.administratorEditorEmails) || cfg.administratorEditorEmails.some(function(e) { return typeof e !== 'string' || !e.includes('@') || e !== e.toLowerCase(); }))gqpFail_('CONFIG_INVALID');
  cfg.bindings.forEach(function(b) {
    if(!b || !id.test(b.formId || '') || !id.test(b.documentId || '') || !id.test(b.reviewFolderId || '') || !id.test(b.readingFolderId || '') || b.reviewFolderId === b.readingFolderId || forms.has(b.formId) || docs.has(b.documentId))gqpFail_('CONFIG_INVALID');
    if(b.assignment !== null && (!b.assignment || !id.test(b.assignment.uid || '') || !Number.isSafeInteger(b.assignment.version) || b.assignment.version < 1))gqpFail_('ASSIGNMENT_INVALID');
    forms.add(b.formId); docs.add(b.documentId);
  });
  return cfg;
}
function gqpPublish_(cfg, approval, ports) {
  gqpConfig_(cfg);
  if(!cfg.enabled)return {code:'QUESTION_PUBLICATION_DISABLED',formWrites:0};
  if(ports.executor() !== cfg.operatorEmail)gqpFail_('OPERATOR_DENIED');
  const b=approval && cfg.bindings.find(function(x) { return x.formId === approval.formId && x.documentId === approval.documentId; });
  if(!b || !b.assignment)gqpFail_('DESIGNATION_REQUIRED');
  function assertApprovalCurrent() {
    const now=ports.now(), age=now-Date.parse(approval.approvedAt), expiry=Date.parse(approval.expiresAt);
    if(approval.version !== 1 || approval.approvedBy !== cfg.operatorEmail || approval.managerUid !== b.assignment.uid || approval.assignmentVersion !== b.assignment.version || !Number.isFinite(age) || age < 0 || age > 86400000 || !Number.isFinite(expiry) || expiry <= now || expiry > Date.parse(approval.approvedAt)+86400000 || !/^[a-f0-9]{64}$/.test(approval.documentSha256 || '') || !approval.baselineForm || approval.baselineForm.formId !== b.formId)gqpFail_('APPROVAL_INVALID');
    return now;
  }
  const now=assertApprovalCurrent();
  const contract=gqpHash_({binding:b,approval:approval}), key=gqpHash_({formId:b.formId,documentId:b.documentId,contract:contract});
  const locked=ports.lock();if(!locked)gqpFail_('BUSY');
  try {
    function authorizedDocument() {
      // Revalidate current profile and exact assignment on every invocation, including recovery.
      const assignment=ports.assignment(b), profile=ports.profile(b.assignment.uid);
      if(!assignment || assignment.uid !== b.assignment.uid || assignment.version !== b.assignment.version || !profile || profile.active !== true || profile.access !== true || profile.uid && profile.uid !== b.assignment.uid || typeof profile.email !== 'string' || !profile.email.includes('@'))gqpFail_('ACCESS_REVOKED');
      const doc=ports.document(b,profile.email.toLowerCase());
      if(doc.sha256 !== approval.documentSha256)gqpFail_('APPROVAL_CHANGED');
      return doc;
    }
    const doc=authorizedDocument(), baseline=gqpModel_(approval.baselineForm), tables=gqrRows_(doc.blob), edited=gqrParse_(typeof mgeQuestionTables_==='function'?mgeQuestionTables_(approval.baselineForm,tables):tables,baseline), plan=gqpPlan_(approval.baselineForm,edited);
    const beforeHash=gqpHash_(gqpContent_(approval.baselineForm)), afterHash=gqpHash_(gqpContent_(plan.target));
    let state=ports.load(key), current=ports.form(b.formId), currentHash=gqpHash_(gqpContent_(current));
    if(current.formId !== b.formId || !current.revisionId)gqpFail_('FORM_INVALID');
    if(state && state.contract !== contract)gqpFail_('RECOVERY_REQUIRED');
    if(state && state.contract === contract && (state.beforeHash !== beforeHash || state.afterHash !== afterHash))gqpFail_('RECOVERY_INVALID');
    if(state && state.contract === contract && currentHash === afterHash && state.status === 'DONE')return {code:'QUESTION_PUBLICATION_UNCHANGED',formWrites:0,changedQuestions:0};
    if(currentHash !== beforeHash && !(state && state.contract === contract && currentHash === afterHash))gqpFail_('FORM_CHANGED');
    if(!plan.requests.length)return {code:'QUESTION_PUBLICATION_UNCHANGED',formWrites:0,changedQuestions:0};
    if(!state) {
      state={version:1,contract:contract,status:'PREPARED',beforeHash:beforeHash,afterHash:afterHash,
        baselineForm:approval.baselineForm, targetForm:plan.target, documentSha256:doc.sha256, preparedAt:new Date(now).toISOString()};
      ports.save(key,state); // Private durable recovery before closing or changing a real Form.
    }
    assertApprovalCurrent(); // Slow dependency reads must not make an expired approval actionable.
    ports.close(b.formId); // Never publishes/reopens; reading/version policy needs revalidation afterwards.
    authorizedDocument(); // Revocation or edit during preparation blocks before the API write.
    current=ports.form(b.formId);currentHash=gqpHash_(gqpContent_(current));
    if(current.formId !== b.formId || typeof current.revisionId !== 'string' || !current.revisionId)gqpFail_('FORM_INVALID');
    if(currentHash !== beforeHash && currentHash !== afterHash)gqpFail_('FORM_CHANGED');
    if(!ports.closed(b.formId))gqpFail_('FORM_NOT_CLOSED');
    let writes=0;
    if(currentHash !== afterHash) {
      // No targetRevisionId merge, native per-item edits or automatic retry on CAS conflict.
      assertApprovalCurrent(); // Recheck after closure and revalidation, immediately before the API write.
      ports.batch(b.formId,{writeControl:{requiredRevisionId:current.revisionId},requests:plan.requests});writes=1;
    }
    const after=ports.form(b.formId);
    if(gqpHash_(gqpContent_(after)) !== afterHash || !ports.closed(b.formId))gqpFail_('WRITE_UNCONFIRMED');
    authorizedDocument();
    state.status='DONE';state.completedAt=new Date(ports.now()).toISOString();state.readingRevalidationRequired=true;ports.save(key,state);
    return {code:writes?'QUESTION_PUBLICATION_APPLIED':'QUESTION_PUBLICATION_RECOVERED',changedQuestions:plan.requests.length,formWrites:writes,readingRevalidationRequired:true};
  } finally { ports.unlock(); }
}
function gqpDraft_(cfg, binding, ports) {
  gqpConfig_(cfg);
  if(ports.executor() !== cfg.operatorEmail)gqpFail_('OPERATOR_DENIED');
  const b=cfg.bindings.find(function(x) { return x.formId === binding.formId && x.documentId === binding.documentId; });
  if(!b || !b.assignment)gqpFail_('DESIGNATION_REQUIRED');
  const assignment=ports.assignment(b), profile=ports.profile(b.assignment.uid);
  if(!assignment || assignment.uid !== b.assignment.uid || assignment.version !== b.assignment.version || !profile || profile.active !== true || profile.access !== true || profile.uid && profile.uid !== b.assignment.uid || typeof profile.email !== 'string')gqpFail_('ACCESS_REVOKED');
  const document=ports.document(b,profile.email.toLowerCase()),form=ports.form(b.formId);
  const tables=gqrRows_(document.blob),edited=gqrParse_(typeof mgeQuestionTables_==='function'?mgeQuestionTables_(form,tables):tables,gqpModel_(form)),plan=gqpPlan_(form,edited);
  return {version:1,code:plan.requests.length?'QUESTION_PUBLICATION_DRAFT_READY':'QUESTION_PUBLICATION_UNCHANGED',formId:b.formId,documentId:b.documentId,
    managerUid:b.assignment.uid,assignmentVersion:b.assignment.version,documentSha256:document.sha256,baselineForm:form,
    changedQuestions:plan.requests.length,approvedBy:null,approvedAt:null,expiresAt:null};
}
function gqpPrivateFile_(id) {
  const file=DriveApp.getFileById(id);
  if(file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length)gqpFail_('STATE_NOT_PRIVATE');
  if(!file.getOwner() || file.getOwner().getEmail().toLowerCase() !== String(Session.getEffectiveUser().getEmail() || '').toLowerCase())gqpFail_('STATE_NOT_PRIVATE');
  if(file.getSize() > 2000000)gqpFail_('STATE_TOO_LARGE');
  return file;
}
function gqpPorts_(cfg) {
  const props=PropertiesService.getScriptProperties(), lock=LockService.getScriptLock(), forms={};
  function native(id) { return forms[id] || (forms[id]=FormApp.openById(id)); }
  function request(id,body) {
    const url='https://forms.googleapis.com/v1/forms/'+encodeURIComponent(id)+(body?':batchUpdate':'');
    const headers={Authorization:'Bearer '+ScriptApp.getOAuthToken()};
    if(cfg.apiQuotaProjectId)headers['x-goog-user-project']=cfg.apiQuotaProjectId;
    const response=UrlFetchApp.fetch(url,{method:body?'post':'get',headers:headers,
      ...(body?{contentType:'application/json',payload:JSON.stringify(body)}:{}),muteHttpExceptions:true,followRedirects:false});
    const status=response.getResponseCode();if(status < 200 || status >= 300)gqpFail_('FORMS_HTTP_'+status);
    return JSON.parse(response.getContentText());
  }
  return {
    now:function() { return Date.now(); },
    executor:function() { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); },
    lock:function() { return lock.tryLock(1000); },unlock:function() { lock.releaseLock(); },
    assignment:function(b) {
      const live=gqpConfig_(gqpResolvedConfig_());
      if(!live.enabled || gqpHash_(live) !== gqpHash_(cfg))gqpFail_('ACCESS_REVOKED');
      const binding=live.bindings.find(function(x) { return x.documentId === b.documentId && x.formId === b.formId; });return binding && binding.assignment;
    },
    profile:function(uid) { return evaluationGet_('users',uid); },
    document:function(b,email) {
      const source=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+b.documentId+'?fields=id,mimeType,parents,trashed,size,lastModifyingUser(emailAddress),owners(emailAddress)');
      if(source.id !== b.documentId || source.trashed || source.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || !(source.parents || []).includes(b.reviewFolderId) || !source.owners || source.owners.length !== 1 || source.owners[0].emailAddress !== cfg.operatorEmail || !source.lastModifyingUser || source.lastModifyingUser.emailAddress.toLowerCase() !== email || !Number.isFinite(Number(source.size)) || Number(source.size) > 20*1024*1024)gqpFail_('DOCUMENT_IDENTITY_INVALID');
      const folder=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+b.reviewFolderId+'?fields=id,mimeType,parents,trashed,inheritedPermissionsDisabled');
      if(folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.inheritedPermissionsDisabled !== true || !(folder.parents || []).includes(b.readingFolderId))gqpFail_('FOLDER_INVALID');
      const allowed=[cfg.operatorEmail,email].concat(cfg.administratorEditorEmails);
      [b.reviewFolderId,b.documentId].forEach(function(id) {
        const grants=graPermissions_(id).filter(function(p) { return p.view !== 'metadata'; });
        if(grants.some(function(p) { return p.type !== 'user' || !allowed.includes(p.emailAddress) || !['owner','writer'].includes(p.role); }) || !grants.some(function(p) { return p.role === 'owner' && p.emailAddress === cfg.operatorEmail; }) || !grants.some(function(p) { return p.emailAddress === email && ['owner','writer'].includes(p.role); }))gqpFail_('REVIEW_ACCESS_INVALID');
      });
      const formMeta=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+b.formId+'?fields=id,mimeType,parents,trashed,owners(emailAddress)');
      if(formMeta.trashed || formMeta.mimeType !== 'application/vnd.google-apps.form' || !(formMeta.parents || []).includes(b.readingFolderId) || !formMeta.owners || formMeta.owners.length !== 1 || formMeta.owners[0].emailAddress !== cfg.operatorEmail)gqpFail_('FORM_IDENTITY_INVALID');
      const blob=gpdfHttp_('https://www.googleapis.com/drive/v3/files/'+b.documentId+'?alt=media').getBlob();
      if(blob.getBytes().length !== Number(source.size))gqpFail_('DOCUMENT_DOWNLOAD_INVALID');
      return {blob:blob,sha256:gqpBytesHash_(blob.getBytes())};
    },
    form:function(id) { return request(id); },batch:function(id,body) { return request(id,body); },
    close:function(id) { if(typeof trainingRepeatInvalidate_==='function')trainingRepeatInvalidate_(id,'QUESTIONS');const f=native(id);f.setAcceptingResponses(false);if(f.isPublished())f.setPublished(false); },
    closed:function(id) { const f=native(id);return !f.isPublished() && !f.isAcceptingResponses(); },
    load:function(key) { const id=props.getProperty('SAHMT_QUESTION_PUBLICATION_'+key);return id?JSON.parse(gqpPrivateFile_(id).getBlob().getDataAsString('UTF-8')):null; },
    save:function(key,value) {
      const prop='SAHMT_QUESTION_PUBLICATION_'+key, id=props.getProperty(prop), text=JSON.stringify(value);
      if(text.length > 1500000)gqpFail_('STATE_TOO_LARGE');
      if(id)gqpPrivateFile_(id).setContent(text);
      else { const file=DriveApp.createFile('SAHMT Recuperacao privada de revisao de questoes.json',text,MimeType.PLAIN_TEXT);file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);props.setProperty(prop,file.getId());gqpPrivateFile_(file.getId()); }
    }
  };
}
function publicarQuestoesAprovadasGestaoV1() {
  let result;
  try {
    if(typeof gqpTrustedConfig_ !== 'function')gqpFail_('CONFIG_MISSING');
    const cfg=gqpConfig_(gqpResolvedConfig_());
    if(!cfg.enabled)result={code:'QUESTION_PUBLICATION_DISABLED',formWrites:0};
    else {
      if(String(Session.getEffectiveUser().getEmail() || '').toLowerCase() !== cfg.operatorEmail || String(Session.getActiveUser().getEmail() || '').toLowerCase() !== cfg.operatorEmail)gqpFail_('OPERATOR_DENIED');
      if(typeof gqpTrustedApproval_ !== 'function')gqpFail_('APPROVAL_REQUIRED');
      const selected=gqpTrustedApproval_();
      if(!selected || !/^[A-Za-z0-9_-]{10,200}$/.test(selected.fileId || '') || !/^[a-f0-9]{64}$/.test(selected.sha256 || ''))gqpFail_('APPROVAL_REQUIRED');
      const blob=gqpPrivateFile_(selected.fileId).getBlob();
      if(gqpBytesHash_(blob.getBytes()) !== selected.sha256)gqpFail_('APPROVAL_CHANGED');
      result=gqpPublish_(cfg,JSON.parse(blob.getDataAsString('UTF-8')),gqpPorts_(cfg));
    }
  } catch(e) { result={code:/^QUESTION_PUBLICATION_[A-Z0-9_]+$/.test(e.message || '')?e.message:'QUESTION_PUBLICATION_UNAVAILABLE',status:'BLOCKED'}; }
  console.log(JSON.stringify(result));return result;
}
