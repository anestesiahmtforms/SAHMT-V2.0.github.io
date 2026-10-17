// Server-only reading gate. No scoring, identity creation or public PDF sharing.
function dgrPolicy_() {
  const raw = sahmtV2Properties_().getProperty('SAHMT_READING_POLICY_JSON');
  if (!raw || raw.length > 8000) throw Error('READING_CONFIG_MISSING');
  const policy = JSON.parse(raw), forms = new Set();
  if (policy.version !== 1 || !Array.isArray(policy.pilotUids) || !policy.pilotUids.length || policy.pilotUids.length > 100 ||
      policy.pilotUids.some(function (uid) { return typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid); }) ||
      !policy.documents || typeof policy.documents !== 'object' || Array.isArray(policy.documents) || !Object.keys(policy.documents).length || Object.keys(policy.documents).length > 100) throw Error('READING_CONFIG_INVALID');
  Object.keys(policy.documents).forEach(function (id) {
    const row = policy.documents[id];
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !row || !/^[A-Za-z0-9_-]{10,200}$/.test(row.formId || '') ||
        !/^[A-Za-z0-9_-]{10,200}$/.test(row.pdfId || '') || !/^[a-f0-9]{32}$/.test(row.checksum || '') ||
        !Number.isSafeInteger(row.pages) || row.pages < 1 || row.pages > 300 || !Number.isSafeInteger(row.version) || row.version < 1 ||
        typeof row.enforced !== 'boolean' || forms.has(row.formId)) throw Error('READING_CONFIG_INVALID');
    forms.add(row.formId);
  });
  return policy;
}
function dgrManagedForm_(formId) {
  if (!sahmtV2Properties_().getProperty('SAHMT_READING_POLICY_JSON')) return false;
  // A broken registered policy must never cause a fallback to broad access.
  try { const p = dgrPolicy_(); return Object.keys(p.documents).some(function (id) { return p.documents[id].formId === formId; }); }
  catch (_) { return true; }
}
function dgrIdentity_(uid, email, policy) {
  const profile = evaluationGet_('users', uid);
  const normalized = String(email || '').trim().toLowerCase();
  if (!policy.pilotUids.includes(uid) || !profile || profile.uid !== uid || profile.active !== true || profile.access !== true ||
      String(profile.email || '').trim().toLowerCase() !== normalized || !/^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/.test(normalized)) throw Error('READING_ACCESS_DENIED');
  const permissions = profile.permissions || {};
  if (profile.role !== 'administrador_app' && permissions.admin !== true && permissions.managementRead !== true && permissions.documentsManage !== true) throw Error('READING_ACCESS_DENIED');
  const access = evaluationGet_('documentAccessEmails', normalized);
  if (!access || access.id !== normalized || access.email !== normalized || access.active !== true || !Array.isArray(access.groups) || !access.groups.includes('GENERAL')) throw Error('READING_ACCESS_DENIED');
  return normalized;
}
function dgrCatalog_(id, row) {
  const doc = evaluationGet_('scopedDocuments', id), pdf = evaluationGet_('scopedDocuments', 'pdf_' + id);
  const area = evaluationGet_('managementAreas', 'area-gestao-de-documentos');
  if (!area || area.active !== true || !doc || !pdf || doc.active !== true || pdf.active !== true || doc.driveFileId !== row.formId || pdf.driveFileId !== row.pdfId ||
      pdf.driveUrl !== 'https://drive.google.com/file/d/' + row.pdfId + '/view' ||
      [doc, pdf].some(function (item) { return item.category !== 'DIRETRIZES' || item.audienceGroup !== 'GENERAL' || item.managementAreaId !== 'area-gestao-de-documentos'; })) throw Error('READING_CATALOG_CHANGED');
}
function dgrPdf_(row, includeBytes) {
  const metadata = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(row.pdfId) + '?fields=id,mimeType,size,md5Checksum,trashed');
  if (metadata.id !== row.pdfId || metadata.mimeType !== 'application/pdf' || metadata.trashed === true || metadata.md5Checksum !== row.checksum ||
      !Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) < 5 || Number(metadata.size) > 6 * 1024 * 1024) throw Error('READING_MATERIAL_CHANGED');
  if (!includeBytes) return {checksum: metadata.md5Checksum};
  const bytes = DriveApp.getFileById(row.pdfId).getBlob().getBytes();
  if (bytes.length !== Number(metadata.size) || bytes.length > 6 * 1024 * 1024 || bytes.slice(0,5).map(function (b) { return String.fromCharCode(b); }).join('') !== '%PDF-') throw Error('READING_PDF_INVALID');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes).map(function (n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join('');
  if (digest !== row.checksum) throw Error('READING_MATERIAL_CHANGED');
  return {bytes: Utilities.base64Encode(bytes), checksum: digest};
}
function dgrReceiptId_(uid, documentId, row) { return sha256Hex_(JSON.stringify([uid, documentId, row.version, row.checksum])); }
function dgrHandle_(request) {
  if (sahmtV2Properties_().getProperty('SAHMT_READING_ENABLED') !== 'YES') throw Error('READING_DISABLED');
  const policy = dgrPolicy_(), row = policy.documents[request.documentId];
  if (!row || row.enforced !== true) throw Error('READING_CUTOVER_REQUIRED');
  if (sahmtV2Properties_().getProperty('SAHMT_READING_CUTOVER_SHA256') !== formsEvaluationHash_(policy.documents)) throw Error('READING_CUTOVER_REQUIRED');
  const email = dgrIdentity_(request.uid, request.email, policy);
  dgrCatalog_(request.documentId, row);
  const pdf = dgrPdf_(row, request.action === 'start');
  const id = dgrReceiptId_(request.uid, request.documentId, row), now = Date.now();
  const result = evaluationRunTransaction_(function (tx) {
    const previous = evaluationGet_('documentReadingReceipts', id, tx);
    let state = previous && evaluationClean_(previous);
    if (request.action === 'start') {
      if (!state || state.expiresAt <= now) state = {uid: request.uid, email: email, documentId: request.documentId, formId: row.formId,
        checksum: row.checksum, materialVersion: row.version, sessionId: Utilities.getUuid().replace(/-/g, ''),
        startedAt: now, expiresAt: now + 7200000, visited: previous && Array.isArray(previous.visited) ? previous.visited : [],
        completedAt: previous && previous.completedAt || null,
        status: previous && previous.status === 'COMPLETED' ? 'COMPLETED' : 'READING'};
    } else {
      if (!['progress', 'complete'].includes(request.action) || !state || state.uid !== request.uid || state.email !== email || state.sessionId !== request.sessionId || state.expiresAt <= now) throw Error('READING_SESSION_INVALID');
      if (!Array.isArray(request.pages) || request.pages.length > row.pages || request.pages.some(function (p) { return !Number.isSafeInteger(p) || p < 1 || p > row.pages; })) throw Error('READING_PAGES_INVALID');
      state.visited = [...new Set(state.visited.concat(request.pages))].sort(function (a,b) { return a-b; });
      if (request.action === 'complete') {
        if (state.visited.length !== row.pages) throw Error('READING_INCOMPLETE');
        state.status = 'COMPLETED'; state.completedAt = state.completedAt || now;
      }
    }
    return {writes: [evaluationWrite_('documentReadingReceipts', id, state, previous)], result: state};
  });
  if (request.action === 'start') return {code: 'READING_STARTED', sessionId: result.sessionId, pages: row.pages, visited: result.visited, pdfBase64: pdf.bytes};
  if (request.action === 'progress') return {code: 'READING_PROGRESS_SAVED', visited: result.visited};
  // A completed receipt is durable even when Google permission propagation fails.
  const url = dgrGrant_(row, email, request.documentId, policy, request.uid);
  return {code: 'READING_RELEASED', formUrl: url};
}
function dgrGrant_(row, email, documentId, policy, uid) {
  const form = FormApp.openById(row.formId);
  let unsafeAudience = false;
  try {
    if (!form.supportsAdvancedResponderPermissions()) throw Error('READING_FORM_UNSUPPORTED');
    // One server-owned registry avoids scanning every participant on each completion.
    const registryId = sha256Hex_(JSON.stringify([documentId,row.version,row.checksum]));
    const expected = evaluationRunTransaction_(function (tx) {
      const receipt=evaluationGet_('documentReadingReceipts',dgrReceiptId_(uid,documentId,row),tx);
      if(!receipt || receipt.uid!==uid || receipt.email!==email || receipt.status!=='COMPLETED' || receipt.materialVersion!==row.version || receipt.checksum!==row.checksum)throw Error('READING_GRANT_PENDING');
      const previous=evaluationGet_('documentReadingGrants',registryId,tx);
      const readers=previous&&Array.isArray(previous.readers)?previous.readers.slice():[];
      if(readers.some(function(r){return (r.uid===uid&&r.email!==email)||(r.email===email&&r.uid!==uid);}))throw Error('READING_GRANT_PENDING');
      if(!readers.some(function(r){return r.uid===uid;}))readers.push({uid:uid,email:email});
      if(readers.length>100)throw Error('READING_GRANT_PENDING');
      const state={documentId:documentId,formId:row.formId,materialVersion:row.version,checksum:row.checksum,readers:readers};
      return {writes:[evaluationWrite_('documentReadingGrants',registryId,state,previous)],result:readers.map(function(r){return r.email;}).sort()};
    });
    if (!expected.includes(email)) throw Error('READING_GRANT_PENDING');
    let permissions = formsEvaluationPublishedPermissions_(row.formId);
    // No unrelated broad/inherited grants may survive a claimed cutover.
    if (permissions.some(function (p) { return p.view === 'published' && (p.type !== 'user' || p.role !== 'reader' || !expected.includes(String(p.emailAddress || '').toLowerCase()) || (p.permissionDetails || []).some(function (d) { return d.inherited === true; })); })) {unsafeAudience=true;throw Error('READING_AUDIENCE_DRIFT');}
    const owners = formsEvaluationExpectedOwners_(permissions, expected);
    if (!owners.includes(email) && !permissions.some(function (p) { return p.view === 'published' && p.emailAddress && p.emailAddress.toLowerCase() === email; })) {
      formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + row.formId + '/permissions?supportsAllDrives=true&sendNotificationEmail=false',
        {method:'post',contentType:'application/json',payload:JSON.stringify({type:'user',role:'reader',view:'published',emailAddress:email})});
    }
    // Other completed readers may not have received a grant yet; only actual grants must be justified.
    permissions = formsEvaluationPublishedPermissions_(row.formId);
    const actual = permissions.filter(function (p) { return p.view === 'published'; });
    if (actual.some(function (p) { return p.type !== 'user' || p.role !== 'reader' || !expected.includes(String(p.emailAddress || '').toLowerCase()) || (p.permissionDetails || []).some(function (d) { return d.inherited === true; }); })) {unsafeAudience=true;throw Error('READING_AUDIENCE_DRIFT');}
    if (!owners.includes(email) && !actual.some(function (p) { return p.type === 'user' && p.role === 'reader' && String(p.emailAddress || '').toLowerCase() === email; })) throw Error('READING_GRANT_PENDING');
    if (!form.isPublished() || !form.isAcceptingResponses()) throw Error('READING_FORM_CLOSED');
    try {dgrIdentity_(uid,email,policy);} catch (error) {
      // A failed Firestore read is not evidence that access was revoked.
      if (error && error.message === 'READING_ACCESS_DENIED') unsafeAudience=true;
      throw Error('READING_GRANT_PENDING');
    }
    const url = form.getPublishedUrl();
    if (!/^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(url)) throw Error('READING_FORM_INVALID');
    return url;
  } catch (_) {
    // An API timeout/propagation delay does not invalidate prior authorized readers.
    // Observed audience drift or a revoked grantee requires a confirmed closure.
    if (unsafeAudience) formsEvaluationCloseForm_(form);
    throw Error('READING_GRANT_PENDING');
  }
}
function dgrMac_(payload, key) { return Utilities.computeHmacSha256Signature('SAHMT_READING_V1\n' + payload, key, Utilities.Charset.UTF_8).map(function (n) { return ('0' + ((n+256)%256).toString(16)).slice(-2); }).join(''); }
function dgrReply_(nonce, data, key) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify(Object.assign({v:1,nonce:nonce},data)),Utilities.Charset.UTF_8).replace(/=+$/,'');
  return ospJson_({payload:payload,mac:dgrMac_(payload,key)});
}
function diretrizesReadingHttp_(event) {
  let request, key, lock;
  try {
    const props = sahmtV2Properties_();
    if (props.getProperty('SAHMT_READING_ENABLED') !== 'YES') return ospJson_({code:'READING_DISABLED'});
    key = props.getProperty('SAHMT_READING_HMAC_SECRET');
    if (!/^[A-Za-z0-9_-]{43}$/.test(key || '')) return ospJson_({code:'READING_CONFIG_MISSING'});
    const raw = event && event.postData && event.postData.contents;
    if (typeof raw !== 'string' || raw.length > 12000) throw Error('READING_INPUT_INVALID');
    const env = JSON.parse(raw);
    if (typeof env.payload !== 'string' || !/^[A-Za-z0-9_-]+$/.test(env.payload) || !ospEqual_(dgrMac_(env.payload,key),env.mac)) throw Error('READING_SIGNATURE_DENIED');
    request = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(env.payload)).getDataAsString('UTF-8'));
    if (request.v !== 1 || request.aud !== 'sahmt-diretrizes-reading' || !/^[a-f0-9]{32}$/.test(request.nonce || '') ||
        !Number.isSafeInteger(request.issuedAt) || !Number.isSafeInteger(request.expiresAt) || request.expiresAt-request.issuedAt !== 60000 || request.issuedAt > Date.now()+5000 || request.expiresAt <= Date.now() ||
        typeof request.uid !== 'string' || !/^[^/\s]{1,128}$/.test(request.uid) || typeof request.email !== 'string' || request.email.length > 254 ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(request.documentId || '') || !['start','progress','complete'].includes(request.action)) throw Error('READING_INPUT_INVALID');
    lock = LockService.getScriptLock();if (!lock.tryLock(1000)) {lock=null;return dgrReply_(request.nonce,{code:'READING_BUSY'},key);}
    if (request.expiresAt <= Date.now()) throw Error('READING_SESSION_INVALID');
    const prefix='SAHMT_READING_NONCE_',all=props.getProperties(),now=Date.now();let count=0;
    Object.keys(all).filter(function (k) {return k.indexOf(prefix)===0;}).forEach(function (k) {if(Number(all[k])<=now)props.deleteProperty(k);else count++;});
    if (props.getProperty(prefix+request.nonce)) return dgrReply_(request.nonce,{code:'READING_REPLAY_DENIED'},key);
    if (count>=256) return dgrReply_(request.nonce,{code:'READING_BUSY'},key);
    props.setProperty(prefix+request.nonce,String(request.expiresAt+5000));
    return dgrReply_(request.nonce,dgrHandle_(request),key);
  } catch (error) {
    const allowed=['READING_DISABLED','READING_ACCESS_DENIED','READING_CONFIG_MISSING','READING_CONFIG_INVALID','READING_CUTOVER_REQUIRED','READING_CATALOG_CHANGED','READING_MATERIAL_CHANGED','READING_PDF_INVALID','READING_SESSION_INVALID','READING_PAGES_INVALID','READING_INCOMPLETE','READING_GRANT_PENDING'];
    const code=allowed.includes(error && error.message)?error.message:'READING_UNAVAILABLE';
    return request && /^[a-f0-9]{32}$/.test(request.nonce || '') && key ? dgrReply_(request.nonce,{code:code},key) : ospJson_({code:'READING_DENIED'});
  } finally {if(lock)lock.releaseLock();}
}
