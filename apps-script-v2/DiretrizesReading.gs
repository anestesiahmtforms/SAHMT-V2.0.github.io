// Server-only reading gate. No scoring, identity creation or public PDF sharing.
// The manifest is published last. Missing, mixed or altered shards always fail closed.
function dgrPolicyBytes_(value) { return encodeURIComponent(value).replace(/%[A-Fa-f0-9]{2}|./g, 'x').length; }
function dgrPolicyRaw_() {
  const props=sahmtV2Properties_(),raw=props.getProperty('SAHMT_READING_POLICY_JSON');
  if(!raw || dgrPolicyBytes_(raw)>8000)throw Error('READING_CONFIG_MISSING');
  let manifest;try{manifest=JSON.parse(raw);}catch(_){throw Error('READING_CONFIG_INVALID');}
  if(manifest.storageVersion!==2)return raw;
  if(!Number.isSafeInteger(manifest.count)||manifest.count<1||manifest.count>64||!/^[a-f0-9]{64}$/.test(manifest.sha256||''))throw Error('READING_CONFIG_INVALID');
  let joined='';
  for(let i=0;i<manifest.count;i++){
    const part=props.getProperty('SAHMT_READING_POLICY_'+manifest.sha256+'_'+i);
    if(typeof part!=='string'||!part.length||dgrPolicyBytes_(part)>8000)throw Error('READING_CONFIG_INVALID');joined+=part;
  }
  if(sha256Hex_(joined)!==manifest.sha256)throw Error('READING_CONFIG_INVALID');return joined;
}
function dgrCategory_(value) { return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase(); }
function dgrAudience_(row) { return row.audienceGroup || 'GENERAL'; }
function dgrValidatePolicy_(policy) {
  const forms=new Set();
  if (policy.version !== 1 || !Array.isArray(policy.pilotUids) || !policy.pilotUids.length || policy.pilotUids.length > 1000 ||
      policy.pilotUids.some(function (uid) { return typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid); }) ||
      !policy.documents || typeof policy.documents !== 'object' || Array.isArray(policy.documents) || !Object.keys(policy.documents).length || Object.keys(policy.documents).length > 1000) throw Error('READING_CONFIG_INVALID');
  Object.keys(policy.documents).forEach(function (id) {
    const row=policy.documents[id],hasForm=row && row.formId!==null;
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !row || (hasForm && !/^[A-Za-z0-9_-]{10,200}$/.test(row.formId || '')) ||
        !/^[A-Za-z0-9_-]{10,200}$/.test(row.pdfId || '') || !/^[a-f0-9]{32}$/.test(row.checksum || '') ||
        !Number.isSafeInteger(row.pages) || row.pages < 1 || row.pages > 300 || !Number.isSafeInteger(row.version) || row.version < 1 ||
        typeof row.enforced !== 'boolean' || (hasForm && forms.has(row.formId)) ||
        !['GENERAL','RESTRICTED'].includes(dgrAudience_(row)) ||
        !['DIRETRIZES','PROTOCOLOS','ROPS','DOCUMENTOS ADMINISTRATIVOS','ORGANOGRAMA'].includes(dgrCategory_(row.category||'DIRETRIZES')) ||
        (row.pdfDocumentId!==undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(row.pdfDocumentId)) || (row.sourceFileId!==undefined && !/^[A-Za-z0-9_-]{10,200}$/.test(row.sourceFileId))) throw Error('READING_CONFIG_INVALID');
    if(hasForm)forms.add(row.formId);
  });return policy;
}
function dgrPolicy_() { try{return dgrValidatePolicy_(JSON.parse(dgrPolicyRaw_()));}catch(error){if(error.message==='READING_CONFIG_MISSING')throw error;throw Error('READING_CONFIG_INVALID');} }
function dgrManagedForm_(formId) {
  if (!sahmtV2Properties_().getProperty('SAHMT_READING_POLICY_JSON')) return false;
  // A broken registered policy must never cause a fallback to broad access.
  try { const p = dgrPolicy_(); return Object.keys(p.documents).some(function (id) { return p.documents[id].formId === formId; }); }
  catch (_) { return true; }
}
// Request-scoped batch only: permissions are freshly read on every action.
// Group by the existing router, so this never moves a read to another project.
function dgrPreflight_(request, row) {
  const email=String(request.email||'').trim().toLowerCase();
  if(!/^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/.test(email))throw Error('READING_ACCESS_DENIED');
  const refs=[['users',request.uid],['documentAccessEmails',email],['scopedDocuments',request.documentId],
    ['scopedDocuments',row.pdfDocumentId||(row.formId?'pdf_'+request.documentId:request.documentId)],['managementAreas','area-gestao-de-documentos']];
  if(row.formId)refs.push(['evaluationFormConfigs',row.formId]);
  const groups={},values=new Map();
  refs.forEach(function(ref){const project=evaluationCollectionProject_(ref[0]),name='projects/'+project+'/databases/(default)/documents/'+ref[0]+'/'+ref[1];
    if(!groups[project])groups[project]=new Map();groups[project].set(name,ref.join('/'));});
  Object.keys(groups).forEach(function(project){
    const expected=groups[project],response=firestoreRequest_(evaluationDocumentsUrl_(':batchGet',project),{method:'post',contentType:'application/json',payload:JSON.stringify({documents:[...expected.keys()]})});
    const seen=new Set();
    (Array.isArray(response)?response:[response]).forEach(function(item){
      const name=item.found&&item.found.name||item.missing;
      if(!expected.has(name)||seen.has(name))throw Error('READING_PREFLIGHT_INVALID');
      seen.add(name);values.set(expected.get(name),item.found?evaluationDocument_(item.found):null);
    });
    if(seen.size!==expected.size)throw Error('READING_PREFLIGHT_INVALID');
  });
  return function(collection,id){const key=collection+'/'+id;if(!values.has(key))throw Error('READING_PREFLIGHT_INVALID');return values.get(key);};
}
function dgrIdentity_(uid, email, policy, row, read) {
  read=read||evaluationGet_;
  const profile = read('users', uid);
  const normalized = String(email || '').trim().toLowerCase();
  if (!policy.pilotUids.includes(uid) || !profile || profile.uid !== uid || profile.active !== true || profile.access !== true ||
      String(profile.email || '').trim().toLowerCase() !== normalized || !/^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/.test(normalized)) throw Error('READING_ACCESS_DENIED');
  const permissions = profile.permissions || {};
  if (profile.role !== 'administrador_app' && permissions.admin !== true && permissions.managementRead !== true && permissions.documentsManage !== true) throw Error('READING_ACCESS_DENIED');
  const access = read('documentAccessEmails', normalized);
  if (!access || access.id !== normalized || access.email !== normalized || access.active !== true || !Array.isArray(access.groups) || !access.groups.includes(dgrAudience_(row || {}))) throw Error('READING_ACCESS_DENIED');
  return normalized;
}
function dgrCatalog_(id, row, read) {
  read=read||evaluationGet_;
  const doc=read('scopedDocuments',id),pdfId=row.pdfDocumentId || (row.formId ? 'pdf_'+id : id),pdf=read('scopedDocuments',pdfId);
  const area=read('managementAreas','area-gestao-de-documentos');
  const category=row.category||'DIRETRIZES',audience=dgrAudience_(row);
  if(!area || area.active!==true || !doc || !pdf || doc.active!==true || pdf.active!==true ||
      doc.driveFileId!==(row.formId || row.sourceFileId || row.pdfId) || pdf.driveFileId!==row.pdfId ||
      pdf.driveUrl!=='https://drive.google.com/file/d/'+row.pdfId+'/view' ||
      [doc,pdf].some(function(item){return item.category!==category || item.audienceGroup!==audience || item.managementAreaId!=='area-gestao-de-documentos';}))throw Error('READING_CATALOG_CHANGED');
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
function dgrReceiptId_(uid, documentId, row) { return sha256Hex_(JSON.stringify([uid, documentId, row.version, row.checksum].concat(row.trainingVersion ? [row.trainingVersion] : []))); }
function dgrOpenMac_(payload) {
  const key=sahmtV2Properties_().getProperty('SAHMT_READING_HMAC_SECRET');
  if(!/^[A-Za-z0-9_-]{43}$/.test(key||''))throw Error('READING_CONFIG_MISSING');
  return Utilities.computeHmacSha256Signature('SAHMT_READING_OPEN_V1\n'+payload,key,Utilities.Charset.UTF_8).map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
}
function dgrOpenTicket_(request,row,policy) {
  const now=Date.now(),payload=Utilities.base64EncodeWebSafe(JSON.stringify({v:1,uid:request.uid,email:request.email,documentId:request.documentId,
    policy:formsEvaluationHash_(policy.documents),trainingVersion:row.trainingVersion||null,issuedAt:now,expiresAt:now+45000}),Utilities.Charset.UTF_8).replace(/=+$/,'');
  return payload+'.'+dgrOpenMac_(payload);
}
function dgrVerifyOpenTicket_(request,policy) {
  if(typeof request.openTicket!=='string'||request.openTicket.length>2500||!/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.test(request.openTicket))throw Error('READING_SESSION_INVALID');
  const parts=request.openTicket.split('.');if(!ospEqual_(dgrOpenMac_(parts[0]),parts[1]))throw Error('READING_SESSION_INVALID');
  let ticket;try{ticket=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));}catch(_){throw Error('READING_SESSION_INVALID');}
  if(ticket.v!==1||ticket.uid!==request.uid||ticket.email!==request.email||ticket.documentId!==request.documentId||ticket.policy!==formsEvaluationHash_(policy.documents)||
    !Number.isSafeInteger(ticket.issuedAt)||!Number.isSafeInteger(ticket.expiresAt)||ticket.expiresAt-ticket.issuedAt!==45000||ticket.issuedAt>Date.now()+5000||ticket.expiresAt<=Date.now()||
    !(ticket.trainingVersion===null||Number.isSafeInteger(ticket.trainingVersion)&&ticket.trainingVersion>=1))throw Error('READING_SESSION_INVALID');
  return ticket;
}
function dgrHandle_(request) {
  if (sahmtV2Properties_().getProperty('SAHMT_READING_ENABLED') !== 'YES') throw Error('READING_DISABLED');
  const policy = dgrPolicy_(); let row = policy.documents[request.documentId];
  if (!row || row.enforced !== true) throw Error('READING_CUTOVER_REQUIRED');
  if (sahmtV2Properties_().getProperty('SAHMT_READING_CUTOVER_SHA256') !== formsEvaluationHash_(policy.documents)) throw Error('READING_CUTOVER_REQUIRED');
  if(!policy.pilotUids.includes(request.uid))throw Error('READING_ACCESS_DENIED');
  let email,pdf;
  if(request.action==='start'&&request.openTicket){
    // Short, identity-bound handoff from the freshly authorized PDF response.
    // It can only create/resume a receipt. Progress/completion still recheck ACL.
    const ticket=dgrVerifyOpenTicket_(request,policy);email=request.email;
    if(ticket.trainingVersion)row=Object.assign({},row,{trainingVersion:ticket.trainingVersion});
  }else{
    const read=dgrPreflight_(request,row);email=dgrIdentity_(request.uid,request.email,policy,row,read);
    const trainingConfig=row.formId&&read('evaluationFormConfigs',row.formId);
    if(trainingConfig&&trainingConfig.repeatPolicy==='FIRST_RESPONSE_PER_VERSION'){
      if(trainingConfig.status!=='READY'||trainingConfig.trainingRevisionRequired===true)throw Error('READING_CUTOVER_REQUIRED');
      row=Object.assign({},row,{trainingVersion:trainingConfig.version});
    }
    dgrCatalog_(request.documentId,row,read);
    pdf=dgrPdf_(row,request.action==='start'||request.action==='open');
  }
  if(request.action==='open')return {code:'READING_PREPARED',openTicket:dgrOpenTicket_(request,row,policy),pages:row.pages,pdfBase64:pdf.bytes,hasForm:Boolean(row.formId)};
  const id = dgrReceiptId_(request.uid, request.documentId, row), now = Date.now();
  const result = evaluationRunTransaction_(function (tx) {
    let liveConfig;
    if(row.trainingVersion){
      const live=liveConfig=evaluationGet_('evaluationFormConfigs',row.formId,tx);
      if(!live || live.status!=='READY' || live.version!==row.trainingVersion || live.trainingRevisionRequired===true)throw Error('READING_CUTOVER_REQUIRED');
    }
    const previous = evaluationGet_('documentReadingReceipts', id, tx);
    let state = previous && evaluationClean_(previous);
    if (request.action === 'start') {
      if (!state || state.expiresAt <= now) state = {uid: request.uid, email: email, documentId: request.documentId, formId: row.formId,
        checksum: row.checksum, materialVersion: row.version, trainingVersion:row.trainingVersion || null, sessionId: Utilities.getUuid().replace(/-/g, ''),
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
    const writes = [evaluationWrite_('documentReadingReceipts', id, state, previous)];
    // Sanitized progress for the existing per-user participation query. No email,
    // reading session ID, PDF bytes or grant capability leaves the reading gate.
    const cfg = request.action!=='progress' && row.formId && (liveConfig||evaluationGet_('evaluationFormConfigs',row.formId,tx));
    if (cfg && cfg.repeatPolicy === 'FIRST_RESPONSE_PER_VERSION' && cfg.status === 'READY') {
      const progressId='reading-'+id, old=evaluationGet_('evaluationParticipations',progressId,tx);
      writes.push(evaluationWrite_('evaluationParticipations',progressId,{id:progressId,recordType:'READING',uid:request.uid,
        activityId:row.formId,creditScopeId:cfg.creditScopeId,version:cfg.version,materialVersion:row.version,
        training:{complete:false,readingComplete:state.status==='COMPLETED',score:null,maxScore:cfg.maxTestScore || 0}},old,['updatedAt']));
    }
    return {writes: writes, result: state};
  });
  if (request.action === 'start') return Object.assign({code:'READING_STARTED',sessionId:result.sessionId,pages:row.pages,visited:result.visited,hasForm:Boolean(row.formId)},pdf?{pdfBase64:pdf.bytes}:{});
  if (request.action === 'progress') return {code: 'READING_PROGRESS_SAVED', visited: result.visited};
  // A completed receipt is durable even when Google permission propagation fails.
  if (!row.formId) return {code:'READING_COMPLETED'};
  const url = dgrGrant_(row, email, request.documentId, policy, request.uid);
  return {code: 'READING_RELEASED', formUrl: url};
}
function dgrGrant_(row, email, documentId, policy, uid) {
  const form = FormApp.openById(row.formId);
  let unsafeAudience = false;
  try {
    if (!form.supportsAdvancedResponderPermissions()) throw Error('READING_FORM_UNSUPPORTED');
    // One server-owned registry avoids scanning every participant on each completion.
    const registryId = sha256Hex_(JSON.stringify([documentId,row.version,row.checksum].concat(row.trainingVersion ? [row.trainingVersion] : [])));
    const expected = evaluationRunTransaction_(function (tx) {
      if(row.trainingVersion){const live=evaluationGet_('evaluationFormConfigs',row.formId,tx);if(!live || live.status!=='READY' || live.version!==row.trainingVersion)throw Error('READING_GRANT_PENDING');}
      const receipt=evaluationGet_('documentReadingReceipts',dgrReceiptId_(uid,documentId,row),tx);
      if(!receipt || receipt.uid!==uid || receipt.email!==email || receipt.status!=='COMPLETED' || receipt.materialVersion!==row.version || receipt.checksum!==row.checksum)throw Error('READING_GRANT_PENDING');
      const previous=evaluationGet_('documentReadingGrants',registryId,tx);
      const readers=previous&&Array.isArray(previous.readers)?previous.readers.slice():[];
      if(readers.some(function(r){return (r.uid===uid&&r.email!==email)||(r.email===email&&r.uid!==uid);}))throw Error('READING_GRANT_PENDING');
      if(!readers.some(function(r){return r.uid===uid;}))readers.push({uid:uid,email:email});
      if(readers.length>1000)throw Error('READING_GRANT_PENDING');
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
    try {dgrIdentity_(uid,email,policy,row);} catch (error) {
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
function dgrFailureCode_(error) {
  if(error && error.message==='READING_INPUT_INVALID')return 'READING_INPUT_INVALID';
  if(error && error.message==='EVALUATION_CROSS_PROJECT_TRANSACTION')return 'READING_TRANSACTION_PROJECT_FAILED';
  if(error && error.status===429)return Number.isFinite(error.retryAfter)?'READING_FIRESTORE_BACKOFF':error.service?'READING_GOOGLE_QUOTA_WAIT':'READING_FIRESTORE_QUOTA_WAIT';
  if(error && error.status===403)return error.service?'READING_GOOGLE_FORBIDDEN':'READING_FIRESTORE_FORBIDDEN';
  if(error && error.status===401)return 'READING_BACKEND_UNAUTHORIZED';
  if(error && error.status>=500)return 'READING_BACKEND_UPSTREAM_FAILED';
  if(error && error.name==='ReferenceError')return 'READING_BACKEND_REFERENCE_FAILED';
  if(error && error.name==='TypeError')return 'READING_BACKEND_TYPE_FAILED';
  return 'READING_BACKEND_FAILED';
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
        !/^[A-Za-z0-9_-]{1,200}$/.test(request.documentId || '') || !['open','start','progress','complete'].includes(request.action)||
        (request.openTicket!==undefined&&(request.action!=='start'||typeof request.openTicket!=='string'||request.openTicket.length>2500||!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(request.openTicket)))) throw Error('READING_INPUT_INVALID');
    lock = LockService.getScriptLock();if (!lock.tryLock(1000)) {lock=null;return dgrReply_(request.nonce,{code:'READING_BUSY'},key);}
    if (request.expiresAt <= Date.now()) throw Error('READING_SESSION_INVALID');
    const prefix='SAHMT_READING_NONCE_',all=props.getProperties(),now=Date.now();let count=0;
    Object.keys(all).filter(function (k) {return k.indexOf(prefix)===0;}).forEach(function (k) {if(Number(all[k])<=now)props.deleteProperty(k);else count++;});
    if (props.getProperty(prefix+request.nonce)) return dgrReply_(request.nonce,{code:'READING_REPLAY_DENIED'},key);
    if (count>=256) return dgrReply_(request.nonce,{code:'READING_BUSY'},key);
    props.setProperty(prefix+request.nonce,String(request.expiresAt+5000));
    // Nonce admission is atomic. Read-only delivery and transactional receipts
    // do not need to block other readers behind a global script lock.
    // Form permission changes remain serialized by the complete action.
    if(request.action!=='complete'){lock.releaseLock();lock=null;}
    const began=Date.now(),answer=dgrHandle_(request);
    console.info(JSON.stringify({code:'READING_OPERATION_TIMING',operation:request.action,durationMs:Date.now()-began}));
    return dgrReply_(request.nonce,answer,key);
  } catch (error) {
    const allowed=['READING_DISABLED','READING_ACCESS_DENIED','READING_CONFIG_MISSING','READING_CONFIG_INVALID','READING_CUTOVER_REQUIRED','READING_CATALOG_CHANGED','READING_MATERIAL_CHANGED','READING_PDF_INVALID','READING_SESSION_INVALID','READING_PAGES_INVALID','READING_INCOMPLETE','READING_GRANT_PENDING'];
    const code=allowed.includes(error && error.message)?error.message:dgrFailureCode_(error);
    if(!allowed.includes(code)){
      const message=String(error&&error.message||''),symbol=message.match(/^([A-Za-z_$][A-Za-z0-9_$]{0,80}) is not defined$/);
      console.warn(JSON.stringify({code:'READING_RUNTIME_FAILURE',operation:request&&['start','progress','complete'].includes(request.action)?request.action:'input',reason:/^(READING|EVALUATION|INDEPENDENT|PDF)_[A-Z_]{1,70}$/.test(message)?message:'UNEXPECTED',kind:['Error','TypeError','ReferenceError','RangeError','SyntaxError'].includes(error&&error.name)?error.name:'Error',status:Number.isInteger(error&&error.status)?error.status:null,missingSymbol:symbol?symbol[1]:null}));
    }
    return request && /^[a-f0-9]{32}$/.test(request.nonce || '') && key ? dgrReply_(request.nonce,{code:code},key) : ospJson_({code:'READING_DENIED'});
  } finally {if(lock)lock.releaseLock();}
}
