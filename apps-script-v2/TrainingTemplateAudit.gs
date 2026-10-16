/** Read-only Forms audit. Creates one private recovery report; never changes a Form or Firestore. */
function auditarModeloTreinamentosGestaoV2() {
  evaluationAssertOperator_(false);
  const expected = 'https://docs.google.com/forms/d/e/1FAIpQLSfAOV83k80v9cqwCynyj4eTZcgKYZIh0gOR53Coo_FZiXEIjg/viewform';
  // Published /d/e/ identifiers are not editable Form IDs. This ID was matched
  // against both the live evaluation configuration and its management document.
  const modelId = '1b27sFKw8L_pr4QEdLcDZ8ZJPY7VNrdtQq06ilw8lKd4';
  const model = formsEvaluationMetadata_(modelId);
  if (String(model.responderUri || '').split('?')[0] !== expected || !model.revisionId) throw Error('TRAINING_MODEL_IDENTITY_NOT_CONFIRMED');
  const loaded = trainingReleaseLoad_();
  const ids = loaded.manifest.items.map(function (item) { return item.formId; });
  // The approved model is itself a catalog entry; auditing it twice is harmless.
  if (new Set(ids).size !== ids.length) throw Error('TRAINING_TARGET_CONFLICT');
  const snapshots = [], failures = [];
  const started = Date.now(), token = ScriptApp.getOAuthToken();
  for (let offset = 0; offset < ids.length; offset += 10) {
    if (Date.now() - started > 180000) { failures.push({code:'TRAINING_AUDIT_TIME_LIMIT', remaining:ids.length - offset}); break; }
    const batch = ids.slice(offset, offset + 10);
    const responses = UrlFetchApp.fetchAll(batch.map(function (id) {
      return {url:'https://forms.googleapis.com/v1/forms/' + encodeURIComponent(id),method:'get',headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true,followRedirects:false};
    }));
    responses.forEach(function (response, index) {
      const httpStatus = response.getResponseCode();
      if (httpStatus !== 200) { failures.push({formId:batch[index],httpStatus:httpStatus,code:'TRAINING_FORM_METADATA_UNAVAILABLE'});return; }
      let metadata;
      try { metadata = JSON.parse(response.getContentText()); } catch (_) { failures.push({formId:batch[index],code:'TRAINING_FORM_METADATA_INVALID'});return; }
      if (metadata.formId !== batch[index] || !metadata.revisionId || !Array.isArray(metadata.items)) { failures.push({formId:batch[index],code:'TRAINING_FORM_METADATA_INVALID'});return; }
      snapshots.push(metadata);
    });
  }
  const reviewMarkers = ['[SAHMT:REVIEW]','[SAHMT:REVIEW_COMPONENTS]','[SAHMT:PREVIOUS_VERSION]','[SAHMT:NEW_VERSION]','[SAHMT:CHANGE_SUMMARY]','[SAHMT:MATERIAL_EVIDENCE]','[SAHMT:QUESTION_EVIDENCE]'];
  const result = {code:failures.length ? 'TRAINING_MODEL_AUDIT_PARTIAL' : 'TRAINING_MODEL_AUDIT_READY',
    targetForms:ids.length,inspectedForms:snapshots.length,failedForms:failures.length,
    modelSections:1 + (model.items || []).filter(function (item) { return !!item.pageBreakItem; }).length,
    formsWithReviewFields:snapshots.filter(function (metadata) { return metadata.items.some(function (item) { return reviewMarkers.some(function (marker) { return String(item.title || '').startsWith(marker); }); }); }).length,
    reviewDestination:'APP_DESIGNATED_MANAGER_ONLY',formWrites:0,firestoreWrites:0,responsesRead:0};
  const report = {schemaVersion:1,createdAt:new Date().toISOString(),modelUrl:expected,model:model,
    manifestDigest:loaded.digest,targets:loaded.manifest.items,snapshots:snapshots,failures:failures,result:result};
  const file = DriveApp.createFile('SAHMT-training-model-audit-' + Date.now() + '.json',JSON.stringify(report),MimeType.PLAIN_TEXT);
  // An inherited/public folder is never used; no permissions are expanded.
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length) throw Error('TRAINING_AUDIT_REPORT_PRIVACY_NOT_CONFIRMED');
  const output = Object.assign({},result,{privateReportUrl:file.getUrl()});
  console.log(JSON.stringify(output));
  return output;
}

/** Reads only response presence (one ID per Form, immediately discarded). No response content or writes to Forms/Firestore. */
function conferirHistoricoAntesPadronizacaoTreinamentosV2() {
  evaluationAssertOperator_(false);
  const reportFile = DriveApp.getFileById('1ICE0wXuCqYfbD42ASNdsTsy82GmKh2Pz');
  if (reportFile.isTrashed() || reportFile.getSharingAccess() !== DriveApp.Access.PRIVATE) throw Error('TRAINING_AUDIT_REPORT_NOT_PRIVATE');
  const audit = JSON.parse(reportFile.getBlob().getDataAsString());
  if (audit.schemaVersion !== 1 || audit.result.code !== 'TRAINING_MODEL_AUDIT_READY' || audit.targets.length !== 76 || audit.snapshots.length !== 76) throw Error('TRAINING_AUDIT_REPORT_INVALID');
  const token = ScriptApp.getOAuthToken(), results = [];
  for (let offset = 0; offset < audit.targets.length; offset += 10) {
    const batch = audit.targets.slice(offset, offset + 10);
    const responses = UrlFetchApp.fetchAll(batch.map(function (item) {
      return {url:'https://forms.googleapis.com/v1/forms/' + encodeURIComponent(item.formId) + '/responses?pageSize=1&fields=responses(responseId)',
        method:'get',headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true,followRedirects:false};
    }));
    responses.forEach(function (response, index) {
      const httpStatus = response.getResponseCode();
      if (httpStatus !== 200) { results.push({formId:batch[index].formId,hasResponses:null,httpStatus:httpStatus});return; }
      let data;
      try { data = JSON.parse(response.getContentText()); } catch (_) { results.push({formId:batch[index].formId,hasResponses:null,httpStatus:httpStatus});return; }
      results.push({formId:batch[index].formId,hasResponses:Array.isArray(data.responses) && data.responses.length > 0,httpStatus:httpStatus});
      data = null;
    });
  }
  const summary = {code:results.some(function (item) { return item.hasResponses === null; }) ? 'TRAINING_RESPONSE_PRESENCE_PARTIAL' : 'TRAINING_RESPONSE_PRESENCE_READY',
    inspectedForms:results.length,withoutResponses:results.filter(function (item) { return item.hasResponses === false; }).length,
    withResponses:results.filter(function (item) { return item.hasResponses === true; }).length,
    unavailable:results.filter(function (item) { return item.hasResponses === null; }).length,formWrites:0,firestoreWrites:0,responseContentsStored:false};
  const file = DriveApp.createFile('SAHMT-training-response-presence-' + Date.now() + '.json',JSON.stringify({schemaVersion:1,auditFileId:reportFile.getId(),results:results,summary:summary}),MimeType.PLAIN_TEXT);
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length) throw Error('TRAINING_AUDIT_REPORT_PRIVACY_NOT_CONFIRMED');
  const output = Object.assign({},summary,{privateReportUrl:file.getUrl()});
  console.log(JSON.stringify(output));return output;
}
