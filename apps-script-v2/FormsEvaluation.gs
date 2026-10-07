/** Spark evaluation adapter. Defining these functions installs nothing and changes no remote form. */
const SAHMT_V2_EVALUATION_FORMS = Object.freeze({pageSize: 100, maxScan: 5000, maxDriveFiles: 1000, maxResponses: 10, maxRequests: 20,
  sources: ['managementAreas', 'documents', 'learningActivities', 'scopedDocuments'],
  markers: {ack: '[SAHMT:ACK]', problem: '[SAHMT:SUGGESTION_PROBLEM]', proposal: '[SAHMT:SUGGESTION_PROPOSAL]', benefit: '[SAHMT:SUGGESTION_BENEFIT]'}});

function formsEvaluationHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, typeof value === 'string' ? value : formsEvaluationStable_(value), Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}
function formsEvaluationStable_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(formsEvaluationStable_).join(',') + ']';
  return '{' + Object.keys(value).filter(function (key) { return value[key] !== undefined; }).sort().map(function (key) { return JSON.stringify(key) + ':' + formsEvaluationStable_(value[key]); }).join(',') + '}';
}
function formsEvaluationId_(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value); }
function formsEvaluationActive_(profile) { return profile && profile.active === true && profile.access === true; }
function formsEvaluationAdmin_(profile) { return formsEvaluationActive_(profile) && (profile.role === 'administrador_app' || (profile.permissions || {}).admin === true); }
function formsEvaluationLink_(value) {
  const input = String(value || '').trim();
  let match = input.match(/^https:\/\/forms\.gle\/([A-Za-z0-9_-]{4,200})\/?(?:[?#].*)?$/);
  if (match) return {kind: 'SHORT_URL', aliasKey: 'short:' + match[1], normalizedUrl: 'https://forms.gle/' + match[1], formId: null};
  match = input.match(/^https:\/\/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]{10,200})(?:\/(?:edit|viewform|prefill|copy|closedform))?\/?(?:[?#].*)?$/);
  if (!match) return null;
  return {kind: match[1] ? 'RESPONDER_ID' : 'EDIT_ID', aliasKey: (match[1] ? 'responder:' : 'form:') + match[2],
    normalizedUrl: 'https://docs.google.com/forms/d/' + (match[1] || '') + match[2] + (match[1] ? '/viewform' : '/edit'), formId: match[1] ? null : match[2]};
}
function formsEvaluationExtractLinks_(value) {
  const result = {};
  function visit(node) {
    if (typeof node === 'string') (node.match(/https:\/\/[^\s<>"'\]\[{}]+/g) || []).forEach(function (candidate) {
      const link = formsEvaluationLink_(candidate.replace(/[),.;!?]+$/, ''));
      if (link) result[link.aliasKey] = link;
    });
    else if (node && typeof node === 'object') Object.keys(node).forEach(function (key) { visit(node[key]); });
  }
  visit(value);
  return Object.keys(result).map(function (key) { return result[key]; });
}
function formsEvaluationGoogleError_(status, url, body) {
  const host = String(url).match(/^https:\/\/(forms|docs|sheets|slides)\.googleapis\.com\//);
  const service = host ? host[1] + '.googleapis.com' : /^https:\/\/www\.googleapis\.com\/drive\//.test(url) ? 'drive.googleapis.com' : '';
  let reason = '', consumerProject = '';
  try {
    // Only classified fields enter the exception. The raw body can contain identities or other private content.
    const raw = typeof body === 'string' && body.length <= 32768 ? JSON.parse(body) : {};
    const fault = raw && raw.error || {};
    const details = Array.isArray(fault.details) ? fault.details : [];
    const allowedReasons = ['SERVICE_DISABLED', 'ACCESS_NOT_CONFIGURED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'IAM_PERMISSION_DENIED', 'ACCESS_DENIED'];
    const info = details.find(function (item) {
      return item && String(item['@type'] || '').endsWith('google.rpc.ErrorInfo') && allowedReasons.includes(item.reason) &&
        (!item.metadata || !item.metadata.service || item.metadata.service === service);
    });
    if (info) {
      reason = info.reason;
      const consumer = String(info.metadata && info.metadata.consumer || '').match(/^projects\/(\d{1,20}|[a-z][a-z0-9-]{4,62})$/);
      if (consumer) consumerProject = consumer[1];
    }
    const oldReasons = Array.isArray(fault.errors) ? fault.errors.map(function (item) { return item && item.reason; }) : [];
    if (!reason && oldReasons.some(function (value) { return ['accessNotConfigured', 'serviceDisabled'].includes(value); })) reason = 'ACCESS_NOT_CONFIGURED';
    if (!reason && (oldReasons.includes('insufficientPermissions') || /^Request had insufficient authentication scopes\.?$/i.test(String(fault.message || '').trim()))) reason = 'ACCESS_TOKEN_SCOPE_INSUFFICIENT';
    if (!reason && oldReasons.some(function (value) { return ['forbidden', 'accessDenied'].includes(value); })) reason = 'ACCESS_DENIED';
  } catch (_) {} // Non-JSON failures keep the generic HTTP diagnostic, without copying body snippets.
  let message = 'Origem Google indisponível (HTTP ' + status + ').';
  const activationUrl = ['SERVICE_DISABLED', 'ACCESS_NOT_CONFIGURED'].includes(reason) && service && consumerProject ?
    'https://console.cloud.google.com/apis/library/' + service + '?project=' + encodeURIComponent(consumerProject) : '';
  if (['SERVICE_DISABLED', 'ACCESS_NOT_CONFIGURED'].includes(reason)) message += ' API ' + (service || 'Google') + ' não ativada' + (consumerProject ? ' no projeto consumidor ' + consumerProject : '') + '.' + (activationUrl ? ' Ative em: ' + activationUrl : ' Confira o projeto Google Cloud associado ao Apps Script.');
  else if (reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') message += ' Escopo OAuth insuficiente para ' + (service || 'a API Google') + '. Reautorize o Apps Script com os escopos do manifesto.' + (service === 'forms.googleapis.com' ? ' Escopo Forms já autorizado: https://www.googleapis.com/auth/forms.' : '');
  else if (['IAM_PERMISSION_DENIED', 'ACCESS_DENIED'].includes(reason)) message += ' Acesso negado à conta executora; confira o acesso ao formulário/arquivo e as políticas da API.';
  else if (status === 403) message += ' Google não informou uma causa classificada; confira a API, os escopos e o acesso da conta executora.';
  const error = new Error(message);
  error.status = status;
  error.reason = reason || (status === 403 ? 'GOOGLE_FORBIDDEN' : 'GOOGLE_API_UNAVAILABLE');
  if (service) error.service = service;
  if (consumerProject) error.consumerProject = consumerProject;
  if (activationUrl) error.activationUrl = activationUrl;
  return error;
}
function formsEvaluationGoogleRequest_(url, options) {
  if (!/^https:\/\/(forms|www|docs|sheets|slides)\.googleapis\.com\//.test(url)) throw new Error('Origem Google API não permitida.');
  const response = UrlFetchApp.fetch(url, Object.assign({muteHttpExceptions: true, headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}}, options || {}));
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw formsEvaluationGoogleError_(status, url, response.getContentText());
  return JSON.parse(response.getContentText() || '{}');
}
function formsEvaluationMetadata_(formId) {
  if (!formsEvaluationId_(formId)) throw new Error('Forms ID inválido.');
  const metadata = formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(formId));
  if (metadata.formId !== formId) throw new Error('A origem resolveu para outro formulário.');
  return metadata;
}
function formsEvaluationResolve_(link, aliases) {
  if (link.formId) { const metadata = formsEvaluationMetadata_(link.formId); return {formId: metadata.formId, metadata: metadata}; }
  if (aliases[link.aliasKey]) return {formId: aliases[link.aliasKey].formId, metadata: formsEvaluationMetadata_(aliases[link.aliasKey].formId)};
  let url = link.normalizedUrl;
  if (link.kind === 'SHORT_URL') {
    for (let hop = 0; hop < 5; hop++) {
      if (!formsEvaluationLink_(url)) throw new Error('Redirecionamento fora do Google Forms.');
      const response = UrlFetchApp.fetch(url, {followRedirects: false, muteHttpExceptions: true});
      const status = response.getResponseCode();
      if (status >= 300 && status < 400) {
        const headers = response.getAllHeaders();
        url = String(headers.Location || headers.location || '');
      } else break;
    }
  }
  const resolvedLink = formsEvaluationLink_(url);
  if (!resolvedLink) throw new Error('Alias do formulário ainda não resolvido.');
  const form = resolvedLink.formId ? FormApp.openById(resolvedLink.formId) : FormApp.openByUrl(resolvedLink.normalizedUrl);
  const metadata = formsEvaluationMetadata_(form.getId());
  const published = formsEvaluationLink_(metadata.responderUri);
  if (!resolvedLink.formId && (!published || published.aliasKey !== resolvedLink.aliasKey)) throw new Error('Alias público não corresponde à origem inspecionada.');
  return {formId: metadata.formId, metadata: metadata};
}
function formsEvaluationAll_(collection, filters, tx) {
  const result = [];
  let previous = null;
  for (;;) {
    const nextFilters = (filters || []).slice();
    if (previous) nextFilters.push(firestoreFilter_('__name__', 'GREATER_THAN', {referenceValue: previous._documentName || previous._name}));
    const page = evaluationQuery_(collection, nextFilters, [{fieldPath: '__name__', direction: 'ASCENDING'}], SAHMT_V2_EVALUATION_FORMS.pageSize, null, tx);
    result.push.apply(result, page);
    if (page.length < SAHMT_V2_EVALUATION_FORMS.pageSize) return result;
    if (result.length >= SAHMT_V2_EVALUATION_FORMS.maxScan) throw new Error('Reconciliação incompleta: limite de leitura alcançado; nenhum vínculo será removido.');
    const last = page[page.length - 1];
    if (previous && previous.id === last.id) throw new Error('Paginação não avançou; reconciliação incompleta.');
    previous = last;
  }
}
function formsEvaluationCommitWrites_(writes) {
  if (!writes.length) return;
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: writes})});
}
function formsEvaluationWriteRecord_(collection, id, changes, previous) {
  formsEvaluationCommitWrites_([evaluationWrite_(collection, id, changes, previous, ['updatedAt'])]);
}
function formsEvaluationDriveReferences_(value) {
  const refs = {};
  function visit(node) {
    if (typeof node === 'string') (node.match(/https:\/\/[^\s<>"'\]\[{}]+/g) || []).forEach(function (url) {
      const match = url.match(/^https:\/\/(?:drive|docs)\.google\.com\/(?:drive\/folders|(?:file|document|spreadsheets|presentation)\/d)\/([A-Za-z0-9_-]{10,200})/);
      if (match) refs[match[1]] = {id: match[1], folder: /\/folders\//.test(url)};
    });
    else if (node && typeof node === 'object') Object.keys(node).forEach(function (key) { visit(node[key]); });
  }
  visit(value);
  return Object.keys(refs).map(function (id) { return refs[id]; });
}
function formsEvaluationReadDrive_(id, chain) {
  chain = chain || [];
  if (chain.includes(id) || chain.length >= 12) throw new Error('Atalho Drive circular ou excessivamente profundo.');
  chain = chain.concat(id);
  const metadata = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,mimeType,modifiedTime,md5Checksum,description,lastModifyingUser(emailAddress),shortcutDetails(targetId,targetMimeType)');
  if (metadata.mimeType === 'application/vnd.google-apps.shortcut') return formsEvaluationReadDrive_(metadata.shortcutDetails.targetId, chain);
  if (metadata.mimeType === 'application/vnd.google-apps.form') return {metadata: metadata, content: 'https://docs.google.com/forms/d/' + id + '/edit'};
  let content = metadata.description || '';
  if (metadata.mimeType === 'application/vnd.google-apps.document') content = formsEvaluationGoogleRequest_('https://docs.googleapis.com/v1/documents/' + encodeURIComponent(id) + '?includeTabsContent=true');
  else if (metadata.mimeType === 'application/vnd.google-apps.spreadsheet') content = formsEvaluationGoogleRequest_('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '?includeGridData=true');
  else if (metadata.mimeType === 'application/vnd.google-apps.presentation') content = formsEvaluationGoogleRequest_('https://slides.googleapis.com/v1/presentations/' + encodeURIComponent(id));
  return {metadata: metadata, content: content, inspected: ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation'].includes(metadata.mimeType)};
}
function formsEvaluationDriveDiscover_(refs) {
  const links = [];
  const errors = [];
  const seen = {};
  function visit(ref, depth) {
    if (seen[ref.id]) return;
    seen[ref.id] = true;
    if (depth > 12 || Object.keys(seen).length > SAHMT_V2_EVALUATION_FORMS.maxDriveFiles) throw new Error('Inspeção de subpastas incompleta: limite alcançado.');
    try {
      if (ref.folder) {
        let token = '';
        do {
          const page = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent("'" + ref.id + "' in parents and trashed = false") + '&fields=files(id,mimeType),nextPageToken&pageSize=100' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
          (page.files || []).forEach(function (file) { visit({id: file.id, folder: file.mimeType === 'application/vnd.google-apps.folder'}, depth + 1); });
          token = page.nextPageToken || '';
        } while (token);
      } else {
        const file = formsEvaluationReadDrive_(ref.id);
        if (file.metadata.mimeType === 'application/vnd.google-apps.folder') { delete seen[file.metadata.id]; visit({id: file.metadata.id, folder: true}, depth + 1); }
        else {
          links.push.apply(links, formsEvaluationExtractLinks_(file.content));
          if (file.inspected === false) errors.push({fileId: ref.id, reason: 'Links internos de arquivo binário/PDF não são inspecionáveis; vínculo manual necessário.'});
        }
      }
    } catch (error) { errors.push({fileId: ref.id, reason: String(error.message || error).slice(0, 200)}); }
  }
  refs.forEach(function (ref) { visit(ref, 0); });
  return {links: links, complete: errors.length === 0, errors: errors};
}
function reconcileEvaluationLinks() {
  evaluationAssertOperator_(false);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING', reason: 'Outro processamento está em execução.'};
  try { return formsEvaluationReconcileLinks_(); } finally { lock.releaseLock(); }
}
function formsEvaluationReconcileLinks_() {
  const existing = formsEvaluationAll_('evaluationLinks');
  const aliases = {};
  const configs = formsEvaluationAll_('evaluationFormConfigs');
  configs.forEach(function (cfg) {
    if (cfg.formId) { const alias = formsEvaluationLink_(cfg.responderUrl); if (alias) aliases[alias.aliasKey] = cfg; }
  });
  const seen = {};
  const incompleteSources = {};
  const outcomes = {scanned: 0, links: 0, pending: 0, removed: 0, failures: []};
  SAHMT_V2_EVALUATION_FORMS.sources.forEach(function (collection) {
    formsEvaluationAll_(collection).forEach(function (source) {
      outcomes.scanned++;
      const areaIds = collection === 'managementAreas' ? [source.id] : source.managementAreaId ? [source.managementAreaId] : Array.isArray(source.areaIds) ? source.areaIds : [];
      const body = source; // Future origin fields containing URLs are discovered without a fixed field catalog.
      const drive = formsEvaluationDriveDiscover_(formsEvaluationDriveReferences_(body));
      if (!drive.complete) { incompleteSources[collection + '/' + source.id] = true; outcomes.failures.push({sourceCollection: collection, sourceId: source.id, reason: 'Conteúdo inacessível ou inspeção incompleta.'}); }
      const links = formsEvaluationExtractLinks_(body).concat(drive.links);
      const unique = {};
      links.forEach(function (link) { unique[link.aliasKey] = link; });
      Object.keys(unique).forEach(function (aliasKey) {
        const link = unique[aliasKey];
        const id = 'link-' + formsEvaluationHash_(collection + '\u0000' + source.id + '\u0000' + aliasKey);
        seen[id] = true;
        const previous = existing.find(function (entry) { return entry.id === id; }) || null;
        let resolved = null;
        let reason = '';
        try { resolved = formsEvaluationResolve_(link, aliases); } catch (error) { reason = String(error.message || error).slice(0, 250); }
        const active = source.active !== false && source.status !== 'INACTIVE';
        const canonicalFormId = resolved ? resolved.formId : previous && previous.formId || '';
        const cfg = canonicalFormId ? evaluationGet_('evaluationFormConfigs', canonicalFormId) : null;
        const status = !active ? 'INACTIVE' : resolved && cfg && cfg.status === 'READY' ? 'READY' : 'CONFIGURATION_PENDING';
        const record = {id: id, sourceCollection: collection, sourceId: source.id, sourceVersion: Number(source.version) || 0,
          areaIds: areaIds, aliasKey: aliasKey, normalizedUrl: link.normalizedUrl, formId: canonicalFormId, active: active,
          status: status, reason: !active ? 'Origem inativa.' : reason || (status === 'READY' ? '' : 'Conferir público, versão, gestor, IDs dos itens e critérios.'), updatedAt: new Date()};
        formsEvaluationWriteRecord_('evaluationLinks', id, record, previous);
        outcomes.links++;
        if (status === 'CONFIGURATION_PENDING') outcomes.pending++;
        if (canonicalFormId) {
          const current = evaluationGet_('evaluationActivities', canonicalFormId);
          const references = existing.filter(function (entry) { return entry.formId === canonicalFormId && entry.active !== false && entry.id !== id; });
          const combinedAreas = [...new Set(areaIds.concat.apply(areaIds, references.map(function (entry) { return entry.areaIds || []; })))];
          const projection = Object.assign({}, current || {}, {id: canonicalFormId, formId: canonicalFormId,
            title: resolved && resolved.metadata.info && resolved.metadata.info.title || current && current.title || source.title || 'Formulário', responderUrl: resolved && resolved.metadata.responderUri || current && current.responderUrl || '',
            areaIds: combinedAreas, active: active || references.length > 0, status: resolved && cfg && cfg.status === 'READY' ? 'READY' : 'CONFIGURATION_PENDING',
            reason: resolved && cfg && cfg.status === 'READY' ? '' : record.reason});
          delete projection._documentName; delete projection._name; delete projection._updateTime; delete projection._createTime;
          if (!current) Object.assign(projection, {creditScopeId: '', version: 0, configVersion: 0, eligibleUids: [], managerUid: '', assignmentId: '', modalities: {acknowledgement: false, suggestion: false, test: false}, maxTestScore: 0, validFrom: null, validUntil: null});
          formsEvaluationWriteRecord_('evaluationActivities', canonicalFormId, projection, current);
          const publicAlias = resolved && formsEvaluationLink_(resolved.metadata.responderUri);
          if (publicAlias) aliases[publicAlias.aliasKey] = {formId: canonicalFormId};
        }
      });
    });
  });
  existing.forEach(function (link) {
    if (seen[link.id] || link.active === false) return;
    if (incompleteSources[link.sourceCollection + '/' + link.sourceId]) {
      formsEvaluationWriteRecord_('evaluationLinks', link.id, {status: 'CONFIGURATION_PENDING', reason: 'Inspeção da origem incompleta; vínculo canônico preservado sem habilitar pontuação.'}, link);
      return;
    }
    formsEvaluationWriteRecord_('evaluationLinks', link.id, {active: false, status: 'INACTIVE', reason: 'Vínculo removido da origem; histórico preservado.'}, link);
    outcomes.removed++;
  });
  const liveLinks = formsEvaluationAll_('evaluationLinks');
  formsEvaluationAll_('evaluationActivities').forEach(function (activity) {
    const references = liveLinks.filter(function (link) { return link.formId === activity.formId && link.active === true; });
    const areas = [...new Set([].concat.apply([], references.map(function (link) { return link.areaIds || []; })))];
    const changes = {areaIds: areas};
    if (!references.length) Object.assign(changes, {active: false, status: 'INACTIVE', reason: 'Nenhum vínculo ativo; registros históricos preservados.'});
    else {
      const cfg = evaluationGet_('evaluationFormConfigs', activity.formId);
      const validated = references.some(function (link) { return link.status === 'READY'; });
      Object.assign(changes, {active: true, status: validated && cfg && cfg.status === 'READY' ? 'READY' : 'CONFIGURATION_PENDING',
        reason: validated && cfg && cfg.status === 'READY' ? '' : 'Vínculo ou configuração aguardando validação da origem; histórico e identidade canônica preservados.'});
    }
    formsEvaluationWriteRecord_('evaluationActivities', activity.id, changes, activity);
  });
  return outcomes;
}

function formsEvaluationQuestionSnapshot_(metadata) {
  return (metadata.items || []).filter(function (item) { return item.questionItem || item.questionGroupItem; }).map(function (item) {
    return {itemId: item.itemId, title: item.title || '', questionItem: item.questionItem || null, questionGroupItem: item.questionGroupItem || null};
  });
}
function formsEvaluationQuestionFingerprint_(questions) {
  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).filter(function (key) { return !['itemId', 'questionId', 'rowQuestionId', 'image', 'contentUri', 'sourceUri'].includes(key); }).forEach(function (key) { result[key] = normalize(value[key]); });
    return result;
  }
  // Fixed administrative/declaration fields do not create another test version.
  return formsEvaluationHash_(questions.filter(function (item) { return !String(item.title || '').startsWith('[SAHMT:') || Number(item.questionItem && item.questionItem.question.grading && item.questionItem.question.grading.pointValue || 0) > 0; }).map(normalize));
}
function formsEvaluationSavedQuestionFingerprint_(record, snapshotKey, fallbackKey) {
  if (!record) return '';
  snapshotKey = snapshotKey || 'questionSnapshot'; fallbackKey = fallbackKey || 'questionFingerprint';
  // Renormalize trusted raw baselines so removing volatile API fields is not a new revision itself.
  return Array.isArray(record[snapshotKey]) && record[snapshotKey].length ? formsEvaluationQuestionFingerprint_(record[snapshotKey]) : record[fallbackKey] || '';
}
function formsEvaluationMaterialSnapshotVerified_(item) {
  // Old native snapshots hashed the temporary URI/IDs. They must be re-baselined, never treated as a real content change.
  return item.contentVerified !== false && !(typeof item.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(item.contentHash) && !item.contentHashFormat);
}

function formsEvaluationNativeReferences_(content) {
  const maps = ['headers', 'footers', 'footnotes', 'lists', 'inlineObjects', 'positionedObjects'];
  const refs = {}, objectRefs = {};
  function visit(value, path, idMap) {
    if (Array.isArray(value)) return value.forEach(function (item, index) { visit(item, path + '[' + index + ']'); });
    if (!value || typeof value !== 'object') return;
    ['objectId', 'tabId', 'headingId'].forEach(function (key) { if (typeof value[key] === 'string') objectRefs[value[key]] = path; });
    Object.keys(value).forEach(function (key) {
      if (maps.includes(key) && value[key] && typeof value[key] === 'object') Object.keys(value[key]).forEach(function (id) { refs[id] = value[key][id]; });
      visit(value[key], path + '.' + (idMap ? '#' : key), maps.includes(key));
    });
  }
  visit(content, '$');
  return {maps: maps, refs: refs, objectRefs: objectRefs};
}
function formsEvaluationNativeMaterialReason_(file) {
  if (!['application/vnd.google-apps.document', 'application/vnd.google-apps.presentation'].includes(file.metadata.mimeType)) return '';
  let opaque = false;
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(function (key) {
      // Docs/Slides image URLs last 30 minutes; JSON IDs or URLs cannot prove the actual image bytes.
      if (['image', 'imageProperties', 'imageFill', 'embeddedDrawingProperties', 'linkedContentReference', 'sheetsChart', 'video', 'equation'].includes(key) && value[key] != null) opaque = true;
      visit(value[key]);
    });
  }
  visit(file.content);
  return opaque ? 'Imagem, desenho ou gráfico nativo sem bytes estáveis verificáveis: preservar MATERIAL como NEEDS_REVIEW; use um arquivo Drive binário com checksum para comprovar o material.' : '';
}
function formsEvaluationContent_(file) {
  const content = file.content;
  const type = file.metadata.mimeType;
  if (type === 'application/vnd.google-apps.spreadsheet') return (content.sheets || []).map(function (sheet) {
    return (sheet.data || []).map(function (grid) { return {startRow: grid.startRow || 0, startColumn: grid.startColumn || 0,
      rowData: (grid.rowData || []).map(function (row) { return (row.values || []).map(function (cell) { return {value: cell.userEnteredValue || null, hyperlink: cell.hyperlink || '', note: cell.note || ''}; }); })}; });
  });
  const native = formsEvaluationNativeReferences_(content);
  const referenceKeys = ['inlineObjectId', 'positionedObjectIds', 'listId', 'headerId', 'footerId', 'footnoteId', 'defaultHeaderId', 'firstPageHeaderId', 'evenPageHeaderId', 'defaultFooterId', 'firstPageFooterId', 'evenPageFooterId'];
  const objectReferenceKeys = ['parentObjectId', 'layoutObjectId', 'masterObjectId', 'notesMasterId', 'speakerNotesObjectId', 'slideObjectId', 'pageObjectId', 'parentTabId', 'headingId'];
  function reference(id, stack) {
    return native.refs[id] && !stack.includes(id) ? normalize(native.refs[id], stack.concat(id)) : null;
  }
  function normalize(value, stack) {
    stack = stack || [];
    if (Array.isArray(value)) return value.map(function (item) { return normalize(item, stack); });
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).filter(function (key) { return !['title', 'revisionId', 'documentId', 'presentationId', 'spreadsheetId', 'objectId', 'tabId', 'startIndex', 'endIndex', 'suggestedInsertionIds', 'suggestedDeletionIds', 'contentUri', 'contentUrl', 'sourceUri', 'sourceUrl'].includes(key); }).forEach(function (key) {
      if (native.maps.includes(key)) {
        // A copied document gets new map keys. Keep actual values sorted independently of those IDs.
        result[key] = Object.keys(value[key] || {}).map(function (id) { return normalize(value[key][id], stack.concat(id)); }).sort(function (a, b) { const first = formsEvaluationStable_(a), second = formsEvaluationStable_(b); return first < second ? -1 : first > second ? 1 : 0; });
      } else if (referenceKeys.includes(key)) {
        // Inline referenced text (footnotes/headers/list properties); changing that text still changes the hash.
        if (Array.isArray(value[key])) result[key] = value[key].map(function (id) { return reference(id, stack); });
        else if (!stack.includes(value[key])) result[key] = reference(value[key], stack);
      } else if (objectReferenceKeys.includes(key)) result[key] = native.objectRefs[value[key]] || null;
      else result[key] = normalize(value[key], stack);
    });
    return result;
  }
  return normalize(content);
}
function formsEvaluationFindQuestion_(metadata, itemId, marker) {
  const matches = (metadata.items || []).filter(function (item) { return itemId ? item.itemId === itemId || item.questionItem && item.questionItem.question.questionId === itemId : String(item.title || '').startsWith(marker); });
  if (matches.length !== 1 || !matches[0].questionItem) throw new Error('Mapeamento ausente ou ambíguo para ' + marker + '.');
  const question = matches[0].questionItem.question;
  if (Number(question.grading && question.grading.pointValue || 0) !== 0) throw new Error('Ciência, sugestão e revisão devem valer zero na nota nativa.');
  return {itemId: matches[0].itemId, questionId: question.questionId, question: question};
}
function formsEvaluationConfiguration_(metadata, payload) {
  if (!metadata.settings || metadata.settings.emailCollectionType !== 'VERIFIED') throw new Error('Formulário precisa coletar e-mail VERIFIED da conta Google.');
  const modalities = payload.modalities || {};
  if (!['acknowledgement', 'suggestion', 'test'].some(function (key) { return modalities[key] === true; }) || Object.keys(modalities).some(function (key) { return !['acknowledgement', 'suggestion', 'test'].includes(key) || typeof modalities[key] !== 'boolean'; })) throw new Error('Defina modalidades reconhecidas.');
  const mapping = {};
  if (modalities.acknowledgement === true) {
    const mapped = formsEvaluationFindQuestion_(metadata, payload.acknowledgementItemId, SAHMT_V2_EVALUATION_FORMS.markers.ack);
    const values = mapped.question.choiceQuestion && mapped.question.choiceQuestion.options || [];
    const affirmative = payload.acknowledgementValue || 'SIM';
    if (!values.some(function (option) { return option.value === affirmative; })) throw new Error('Valor afirmativo da ciência não está entre as opções reais.');
    mapping.acknowledgement = {itemId: mapped.itemId, questionId: mapped.questionId, affirmativeValue: affirmative};
  }
  if (modalities.suggestion === true) {
    ['problem', 'proposal', 'benefit'].forEach(function (part) {
      const field = 'suggestion' + part.charAt(0).toUpperCase() + part.slice(1) + 'ItemId';
      const mapped = formsEvaluationFindQuestion_(metadata, payload[field], SAHMT_V2_EVALUATION_FORMS.markers[part]);
      mapping[part] = {itemId: mapped.itemId, questionId: mapped.questionId};
    });
  }
  let maxScore = 0;
  if (modalities.test === true) {
    if (!metadata.settings.quizSettings || metadata.settings.quizSettings.isQuiz !== true) throw new Error('Teste exige quiz corrigido pelo Google Forms.');
    const scored = (metadata.items || []).filter(function (item) { return item.questionItem && Number(item.questionItem.question.grading && item.questionItem.question.grading.pointValue || 0) > 0; });
    if (!scored.length) throw new Error('Teste não tem questões pontuadas.');
    scored.forEach(function (item) {
      const question = item.questionItem.question;
      if (!question.choiceQuestion || !['RADIO', 'CHECKBOX'].includes(question.choiceQuestion.type) || !question.grading.correctAnswers || !(question.grading.correctAnswers.answers || []).length || !Number.isInteger(question.grading.pointValue) || question.grading.correctAnswers.answers.some(function (answer) { return !(question.choiceQuestion.options || []).some(function (option) { return option.value === answer.value; }); })) throw new Error('Conferir múltipla escolha, gabarito e peso de cada questão pontuada.');
      maxScore += question.grading.pointValue;
    });
  }
  const reviewMarkers = {components:'[SAHMT:REVIEW_COMPONENTS]', previousVersion:'[SAHMT:PREVIOUS_VERSION]', newVersion:'[SAHMT:NEW_VERSION]', summary:'[SAHMT:CHANGE_SUMMARY]', materialEvidence:'[SAHMT:MATERIAL_EVIDENCE]', questionEvidence:'[SAHMT:QUESTION_EVIDENCE]'};
  if ((metadata.items || []).some(function (item) { return String(item.title || '').startsWith(reviewMarkers.components); })) {
    mapping.review = {};
    Object.keys(reviewMarkers).forEach(function (field) { const mapped = formsEvaluationFindQuestion_(metadata, '', reviewMarkers[field]); mapping.review[field] = {itemId:mapped.itemId,questionId:mapped.questionId}; });
  }
  const questions = formsEvaluationQuestionSnapshot_(metadata);
  return {mapping: mapping, questionSnapshot: questions, questionFingerprint: formsEvaluationQuestionFingerprint_(questions), maxTestScore: maxScore};
}
function formsEvaluationMappingPayload_(cfg) {
  const mapping = cfg.mapping || {};
  return {modalities: cfg.modalities,
    acknowledgementItemId: cfg.acknowledgementItemId || mapping.acknowledgement && mapping.acknowledgement.itemId || '',
    acknowledgementValue: cfg.acknowledgementValue || mapping.acknowledgement && mapping.acknowledgement.affirmativeValue || 'SIM',
    suggestionProblemItemId: cfg.suggestionProblemItemId || mapping.problem && mapping.problem.itemId || '',
    suggestionProposalItemId: cfg.suggestionProposalItemId || mapping.proposal && mapping.proposal.itemId || '',
    suggestionBenefitItemId: cfg.suggestionBenefitItemId || mapping.benefit && mapping.benefit.itemId || ''};
}
function formsEvaluationMappedCriteria_(questions, mapping) {
  const result = [];
  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    const clean = {};
    Object.keys(value).filter(function (key) { return !['questionId', 'rowQuestionId', 'image', 'contentUri', 'sourceUri'].includes(key); }).forEach(function (key) { clean[key] = normalize(value[key]); });
    return clean;
  }
  function visit(value, path) {
    if (!value || typeof value !== 'object') return;
    if (value.itemId && value.questionId) {
      const item = (questions || []).find(function (question) { return question.itemId === value.itemId; });
      if (!item || !item.questionItem || item.questionItem.question.questionId !== value.questionId) throw new Error('ID real do campo não corresponde ao snapshot configurado.');
      result.push({field: path, question: normalize(item.questionItem.question)});
    } else Object.keys(value).sort().forEach(function (key) { visit(value[key], path ? path + '.' + key : key); });
  }
  visit(mapping, '');
  return result;
}
function formsEvaluationCheckedMapping_(metadata, cfg) {
  const checked = formsEvaluationConfiguration_(metadata, formsEvaluationMappingPayload_(cfg));
  if (formsEvaluationHash_(checked.mapping) !== formsEvaluationHash_(cfg.mapping || {}) ||
      formsEvaluationHash_(formsEvaluationMappedCriteria_(checked.questionSnapshot, checked.mapping)) !== formsEvaluationHash_(formsEvaluationMappedCriteria_(cfg.questionSnapshot, cfg.mapping))) throw new Error('IDs, opções ou regras dos campos mudaram sem configuração vigente.');
  return checked;
}
function formsEvaluationMaterialFingerprint_(snapshot) {
  return formsEvaluationHash_([...new Set((snapshot || []).map(function (item) { return item.contentHash; }))].sort());
}
function formsEvaluationComponentDuplicates_(revision, tx) {
  // Actual content, not a new version label, copy, UID, assignment or another linked area, defines the credited change.
  const candidates = formsEvaluationAll_('evaluationGovernanceRevisions', [firestoreFilter_('creditScopeId','EQUAL',{stringValue:revision.creditScopeId})], tx);
  return revision.components.filter(function (component) {
    const before = component === 'MATERIAL' ? 'materialFingerprintBefore' : 'questionFingerprintBefore';
    const after = component === 'MATERIAL' ? 'materialFingerprintAfter' : 'questionFingerprintAfter';
    return candidates.some(function (candidate) { return candidate.id !== revision.id && (candidate.approvedComponents || []).includes(component) && (component === 'QUESTIONS' ? formsEvaluationSavedQuestionFingerprint_(candidate, 'questionSnapshotBefore', before) === formsEvaluationSavedQuestionFingerprint_(revision, 'questionSnapshotBefore', before) && formsEvaluationSavedQuestionFingerprint_(candidate, 'questionSnapshotAfter', after) === formsEvaluationSavedQuestionFingerprint_(revision, 'questionSnapshotAfter', after) : candidate[before] === revision[before] && candidate[after] === revision[after]); });
  });
}
function formsEvaluationMaterialSnapshot_(urls) {
  if (!Array.isArray(urls) || urls.length > 10 || urls.some(function (url) { return typeof url !== 'string' || !/^https:\/\/[^\s]+$/.test(url); })) throw new Error('Evidências de materiais exigem até dez URLs HTTPS.');
  return urls.map(function (url) {
    const references = formsEvaluationDriveReferences_(url);
    if (references.length !== 1 || references[0].folder) throw new Error('Material exige arquivo Drive identificável; origem não verificável fica pendente.');
    const file = formsEvaluationReadDrive_(references[0].id);
    const content = formsEvaluationContent_(file);
    if (!file.metadata.md5Checksum && (!content || typeof content === 'string' && content === (file.metadata.description || ''))) throw new Error('Não foi possível comprovar o conteúdo do material.');
    const verificationReason = file.metadata.md5Checksum ? '' : formsEvaluationNativeMaterialReason_(file);
    return {fileId: references[0].id, contentHash: file.metadata.md5Checksum || formsEvaluationHash_(content), contentHashFormat: file.metadata.md5Checksum ? 'DRIVE_MD5_V1' : file.metadata.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'NATIVE_CELLS_V1' : 'NATIVE_SEMANTIC_V2', contentVerified: !verificationReason, verificationStatus: verificationReason ? 'NEEDS_REVIEW' : 'CONFIRMED', verificationReason: verificationReason, modifiedTime: file.metadata.modifiedTime || '', modifierEmail: file.metadata.lastModifyingUser && file.metadata.lastModifyingUser.emailAddress || '', url: url};
  });
}

function formsEvaluationAssignments_(payload, actorUid, tx) {
  const actor = evaluationGet_('users', actorUid, tx);
  if (!formsEvaluationAdmin_(actor)) throw new Error('Somente administrador autorizado pode designar gestor.');
  if (!formsEvaluationId_(payload.areaId) || !formsEvaluationId_(payload.managerUid) || !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) throw new Error('Designação inválida.');
  const area = evaluationGet_('managementAreas', payload.areaId, tx);
  const manager = evaluationGet_('users', payload.managerUid, tx);
  const previous = evaluationGet_('evaluationAssignments', payload.areaId, tx);
  if (!area || area.active !== true || !formsEvaluationActive_(manager)) throw new Error('Área ou gestor não possui acesso vigente.');
  if ((previous ? previous.version : 0) !== payload.expectedVersion) throw new Error('A designação mudou; atualize antes de salvar.');
  if (previous && previous.uid === payload.managerUid) return {writes: [], result: {status: 'CONFIRMED', alreadyAssigned: true}};
  const version = (previous ? previous.version : 0) + 1;
  const historyId = 'assignment-' + formsEvaluationHash_(payload.areaId + '\u0000' + version);
  const record = {id: payload.areaId, areaId: payload.areaId, uid: payload.managerUid, version: version, effectiveAt: new Date(), actorUid: actorUid};
  const history = {id: historyId, areaId: payload.areaId, previousUid: previous ? previous.uid : '', uid: payload.managerUid,
    previousVersion: previous ? previous.version : 0, version: version, previousEffectiveAt: previous ? previous.effectiveAt : null, effectiveAt: new Date(), actorUid: actorUid};
  const writes = [evaluationWrite_('evaluationAssignments', payload.areaId, record, previous, ['effectiveAt']),
    evaluationWrite_('evaluationAssignmentHistory', historyId, history, null, ['effectiveAt'])];
  // Change current responsibility only; existing credit, reviewer identity and designation history are never transferred.
  const configs = formsEvaluationAll_('evaluationFormConfigs', [firestoreFilter_('managerAreaId', 'EQUAL', {stringValue: payload.areaId})], tx);
  configs.forEach(function (cfg) {
    const configVersion = (Number(cfg.configVersion) || 0) + 1;
    const owner = {managerUid: payload.managerUid, assignmentId: payload.areaId, assignmentVersion: version, configVersion: configVersion};
    writes.push(evaluationWrite_('evaluationFormConfigs', cfg.id, owner, cfg, ['updatedAt']));
    const activity = evaluationGet_('evaluationActivities', cfg.id, tx);
    if (activity) writes.push(evaluationWrite_('evaluationActivities', cfg.id, owner, activity, ['updatedAt']));
    const pending = formsEvaluationAll_('evaluationParticipations', [firestoreFilter_('activityId', 'EQUAL', {stringValue:cfg.id}), firestoreFilter_('suggestion.status', 'EQUAL', {stringValue:'PENDING'})], tx);
    pending.forEach(function (participation) { writes.push(evaluationWrite_('evaluationParticipations', participation.id, {managerUid:payload.managerUid, submittedManagerUid:participation.submittedManagerUid || participation.managerUid}, participation, ['updatedAt'])); });
  });
  if (writes.length + 1 > SAHMT_V2_EVALUATION_LEDGER.maxWrites) throw new Error('Designação excede o limite de transação; preservar como pendente sem atualizar projeção parcial.');
  return {writes: writes, result: {status:'CONFIRMED', assignmentId:payload.areaId, assignmentVersion:version, updatedActivities:configs.length}};
}
function formsEvaluationGroupRoster_(groups, tx) {
  const accepted = Array.isArray(groups) ? groups.filter(function (group) { return ['GENERAL', 'RESTRICTED'].includes(group); }) : [];
  if (!accepted.length) return [];
  return formsEvaluationAll_('documentAccessEmails', [], tx).filter(function (entry) {
    const email = String(entry.email || '').trim().toLowerCase();
    return entry.active === true && email === String(entry.id || '').trim().toLowerCase() &&
      /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) && Array.isArray(entry.groups) &&
      entry.groups.some(function (group) { return accepted.includes(group); });
  });
}
function formsEvaluationEligibleProfile_(cfg, profile, tx) {
  if (!formsEvaluationActive_(profile) || !formsEvaluationId_(profile.uid || profile.id) || (profile.uid && profile.id && profile.uid !== profile.id)) return false;
  if (Array.isArray(cfg.eligibleUids) && cfg.eligibleUids.includes(profile.uid || profile.id)) return true;
  const groups = Array.isArray(cfg.eligibleGroups) ? cfg.eligibleGroups : [];
  const email = String(profile.email || '').trim().toLowerCase();
  return Boolean(email && groups.length && formsEvaluationGroupRoster_(groups, tx).some(function (entry) { return entry.email === email; }));
}
function formsEvaluationResponderEmails_(cfg, tx) {
  const emails = formsEvaluationGroupRoster_(cfg.eligibleGroups || [], tx).map(function (entry) { return entry.email; });
  const uids = Array.isArray(cfg.eligibleUids) ? [...new Set(cfg.eligibleUids)] : [];
  if (uids.length) {
    const profiles = formsEvaluationAll_('users', [], tx);
    uids.forEach(function (uid) {
      const profile = profiles.find(function (entry) { return entry.id === uid; });
      const email = String(profile && profile.email || '').trim().toLowerCase();
      const identity = formsEvaluationResolveIdentity_({settings: {emailCollectionType: 'VERIFIED'}}, {respondentEmail: email}, profiles);
      if (!formsEvaluationId_(uid) || !formsEvaluationActive_(profile) || identity.status !== 'CONFIRMED' || identity.uid !== uid ||
          !/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw new Error('UID individual não possui perfil aprovado e identidade única.');
      emails.push(email);
    });
  }
  const expected = [...new Set(emails)].sort();
  if (!expected.length) throw new Error('O público autorizado está vazio; formulário deve continuar fechado.');
  return expected;
}
function formsEvaluationCloseForm_(form) {
  // Each close operation is attempted independently: one failing API must not skip the other.
  try { if (typeof form.setPublished === 'function') form.setPublished(false); } catch (_) {}
  try { form.setAcceptingResponses(false); } catch (_) {}
  let closed = false;
  try { closed = form.isAcceptingResponses() === false &&
    (typeof form.supportsAdvancedResponderPermissions !== 'function' || !form.supportsAdvancedResponderPermissions() || form.isPublished() === false); } catch (_) {}
  if (!closed) throw new Error('Fechamento do Google Form não confirmado; acesso externo exige reconciliação.');
  return true;
}
function formsEvaluationPublishedPermissions_(formId) {
  // Google documents responder grants as Drive permissions with view=published. User[] alone misses anyone/domain grants.
  // https://developers.google.com/workspace/forms/api/guides/publish-form
  const result = [], tokens = new Set();
  let token = '';
  do {
    const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(formId) + '/permissions?includePermissionsForView=published&supportsAllDrives=true&pageSize=100&fields=' +
      encodeURIComponent('nextPageToken,permissions(id,type,role,emailAddress,view,deleted,permissionDetails(inherited,inheritedFrom))') + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    const page = formsEvaluationGoogleRequest_(url);
    if (!page || !Array.isArray(page.permissions)) throw new Error('Lista de permissões publicada não pôde ser comprovada.');
    result.push.apply(result, page.permissions);
    if (result.length > SAHMT_V2_EVALUATION_FORMS.maxScan) throw new Error('Lista de respondentes excede a varredura completa.');
    token = String(page.nextPageToken || '');
    if (token && tokens.has(token)) throw new Error('Paginação de permissões não avançou.');
    if (token) tokens.add(token);
  } while (token);
  return result;
}
function formsEvaluationPublishedPermissionsExact_(permissions, expected) {
  const published = permissions.filter(function (permission) { return permission.view === 'published'; });
  if (published.some(function (permission) { return permission.type !== 'user' || permission.role !== 'reader' || permission.deleted === true ||
    (permission.permissionDetails || []).some(function (detail) { return detail.inherited === true; }) ||
    !expected.includes(String(permission.emailAddress || '').trim().toLowerCase()); })) return false;
  const actual = published.map(function (permission) { return String(permission.emailAddress || '').trim().toLowerCase(); }).sort();
  return actual.length === expected.length && actual.every(function (email, index) { return email === expected[index]; });
}
function formsEvaluationSyncResponders_(form, emails) {
  try {
    formsEvaluationCloseForm_(form);
    if (!emails.length || typeof form.supportsAdvancedResponderPermissions !== 'function' || !form.supportsAdvancedResponderPermissions() || typeof form.setPublished !== 'function') return false;
    const formId = form.getId();
    let permissions = formsEvaluationPublishedPermissions_(formId);
    permissions.filter(function (permission) { return permission.view === 'published'; }).forEach(function (permission) {
      if ((permission.permissionDetails || []).some(function (detail) { return detail.inherited === true; })) throw new Error('Acesso de respondente herdado não pode ser restringido neste formulário.');
      const email = String(permission.emailAddress || '').trim().toLowerCase();
      if (permission.type === 'user' && permission.role === 'reader' && permission.deleted !== true && emails.includes(email)) return;
      if (!permission.id || permission.role !== 'reader' || !['user','anyone','domain','group'].includes(permission.type)) throw new Error('Permissão publicada não pode ser removida com segurança.');
      // Delete only the published grant by its ID. removePublishedReader can remove editor/viewer rights too.
      formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(formId) + '/permissions/' + encodeURIComponent(permission.id) + '?supportsAllDrives=true', {method: 'delete'});
    });
    permissions = formsEvaluationPublishedPermissions_(formId);
    emails.forEach(function (email) {
      if (!permissions.some(function (permission) { return permission.view === 'published' && permission.type === 'user' && permission.role === 'reader' && String(permission.emailAddress || '').trim().toLowerCase() === email; })) {
        formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(formId) + '/permissions?supportsAllDrives=true&sendNotificationEmail=false',
          {method: 'post', contentType: 'application/json', payload: JSON.stringify({type: 'user', role: 'reader', view: 'published', emailAddress: email})});
      }
    });
    if (!formsEvaluationPublishedPermissionsExact_(formsEvaluationPublishedPermissions_(formId), emails)) throw new Error('Respondentes publicados não correspondem ao público autorizado.');
    form.setPublished(true);
    form.setAcceptingResponses(true);
    if (!form.isPublished() || !form.isAcceptingResponses() || !formsEvaluationPublishedPermissionsExact_(formsEvaluationPublishedPermissions_(formId), emails)) throw new Error('Publicação e respondentes não confirmados.');
    return true;
  } catch (_) {
    formsEvaluationCloseForm_(form);
    return false;
  }
}
function formsEvaluationPublicationContext_(cfg, tx) {
  const assignment = evaluationGet_('evaluationAssignments', cfg.managerAreaId, tx);
  const area = evaluationGet_('managementAreas', cfg.managerAreaId, tx);
  if (!formsEvaluationAdmin_(evaluationGet_('users', cfg.configuredByUid, tx)) || !area || area.active !== true || !assignment ||
      assignment.uid !== cfg.managerUid || assignment.version !== cfg.assignmentVersion || !formsEvaluationActive_(evaluationGet_('users', assignment.uid, tx))) throw new Error('Designação, área ou administrador da configuração não possui acesso vigente.');
  return formsEvaluationResponderEmails_(cfg, tx);
}
function formsEvaluationReleaseGate_(formId, activity, cfg) {
  if (!activity.trainingReleaseManifestDigest) return null;
  try {
    if (activity.trainingReleaseBlocked === true || cfg.trainingReleaseBlocked === true || typeof trainingReleaseVerifyPublication_ !== 'function') throw new Error('Catálogo exige nova validação privada antes da publicação.');
    const verified = trainingReleaseVerifyPublication_(formId);
    if (!verified || verified.formId !== formId || verified.manifestDigest !== activity.trainingReleaseManifestDigest || verified.formDigest !== activity.trainingReleaseDigest ||
        !/^[a-f0-9]{64}$/.test(verified.manifestDigest) || !/^[a-f0-9]{64}$/.test(verified.formDigest)) throw new Error('Prova privada do catálogo não corresponde à projeção.');
    return {formId: formId, manifestDigest: verified.manifestDigest, formDigest: verified.formDigest};
  } catch (_) {
    const error = new Error('Catálogo exige nova validação privada antes da publicação.');
    error.trainingReleaseBlocked = true;
    throw error;
  }
}
function formsEvaluationReleaseGateUnchanged_(expected, activity, cfg) {
  if (!expected && !activity.trainingReleaseManifestDigest) return true;
  if (expected && expected.manifestDigest === activity.trainingReleaseManifestDigest && expected.formDigest === activity.trainingReleaseDigest &&
      activity.trainingReleaseBlocked !== true && cfg.trainingReleaseBlocked !== true) return true;
  const error = new Error('Prova privada do catálogo mudou durante a publicação.');
  error.trainingReleaseBlocked = true;
  throw error;
}
function formsEvaluationPublicationPending_(formId, configVersion, closureConfirmed, releaseBlocked) {
  return evaluationRunTransaction_(function (tx) {
    const cfg = evaluationGet_('evaluationFormConfigs', formId, tx), activity = evaluationGet_('evaluationActivities', formId, tx);
    if (!cfg || !activity || cfg.configVersion !== configVersion) return {writes: [], result: {status: 'CONFIGURATION_PENDING'}};
    const blocked = releaseBlocked === true || cfg.trainingReleaseBlocked === true || activity.trainingReleaseBlocked === true;
    const pending = {status: 'CONFIGURATION_PENDING', reason: closureConfirmed ? blocked ? 'Catálogo exige nova validação privada antes da publicação.' : 'Respondentes ou publicação pendentes de reconciliação.' : 'Fechamento do Google Form não confirmado; acesso externo exige reconciliação.', publicationPending: !blocked && (cfg.publicationPending === true || cfg.status === 'READY')};
    if (blocked) pending.trainingReleaseBlocked = true;
    return {writes: [evaluationWrite_('evaluationFormConfigs', formId, pending, cfg, ['updatedAt']), evaluationWrite_('evaluationActivities', formId, pending, activity, ['updatedAt'])], result: {status: pending.status}};
  });
}
function formsEvaluationFinalizePublication_(formId, requestId) {
  let form = null, configVersion = null;
  try {
    const cfg = evaluationGet_('evaluationFormConfigs', formId), activity = evaluationGet_('evaluationActivities', formId);
    if (!cfg || !activity || !Array.isArray(cfg.eligibleGroups) || !cfg.eligibleGroups.length || (cfg.status !== 'READY' && cfg.publicationPending !== true)) return {status: 'CONFIGURATION_PENDING'};
    configVersion = cfg.configVersion;
    form = FormApp.openById(formId);
    const releaseProof = formsEvaluationReleaseGate_(formId, activity, cfg);
    const emails = formsEvaluationPublicationContext_(cfg, null);
    const metadata = formsEvaluationMetadata_(formId);
    formsEvaluationCheckedMapping_(metadata, cfg);
    if (formsEvaluationQuestionFingerprint_(formsEvaluationQuestionSnapshot_(metadata)) !== formsEvaluationSavedQuestionFingerprint_(cfg) || !form.hasLimitOneResponsePerUser() || form.canEditResponse()) throw new Error('Conteúdo ou opções do Forms mudaram; exige configuração vigente.');
    if (cfg.status === 'READY' && form.isPublished() && form.isAcceptingResponses() && formsEvaluationPublishedPermissionsExact_(formsEvaluationPublishedPermissions_(formId), emails)) return {status: 'READY', activityId: formId, configVersion: configVersion, unchanged: true};
    formsEvaluationCloseForm_(form);
    // Persist a recoverable closed stage before any publication. No transaction callback opens a Google Form.
    evaluationRunTransaction_(function (tx) {
      const live = evaluationGet_('evaluationFormConfigs', formId, tx), projected = evaluationGet_('evaluationActivities', formId, tx);
      if (!live || !projected || projected.active !== true || live.configVersion !== configVersion || (live.status !== 'READY' && live.publicationPending !== true) ||
          formsEvaluationStable_(formsEvaluationPublicationContext_(live, tx)) !== formsEvaluationStable_(emails)) throw new Error('Público ou configuração mudou antes da publicação.');
      formsEvaluationReleaseGateUnchanged_(releaseProof, projected, live);
      const changes = {status: 'CONFIGURATION_PENDING', reason: 'Respondentes em validação antes da publicação.', publicationPending: true};
      return {writes: [evaluationWrite_('evaluationFormConfigs', formId, changes, live, ['updatedAt']), evaluationWrite_('evaluationActivities', formId, changes, projected, ['updatedAt'])], result: {status: changes.status}};
    });
    if (!formsEvaluationSyncResponders_(form, emails)) throw new Error('Permissões ou publicação do Forms não confirmadas.');
    const verifiedActivity = evaluationGet_('evaluationActivities', formId), verifiedCfg = evaluationGet_('evaluationFormConfigs', formId);
    if (!verifiedActivity || !verifiedCfg) throw new Error('Configuração ausente após verificar os respondentes.');
    const verifiedProof = formsEvaluationReleaseGate_(formId, verifiedActivity, verifiedCfg);
    formsEvaluationReleaseGateUnchanged_(releaseProof, verifiedActivity, verifiedCfg);
    if (formsEvaluationStable_(verifiedProof) !== formsEvaluationStable_(releaseProof)) throw new Error('Verificação privada mudou durante a publicação.');
    return evaluationRunTransaction_(function (tx) {
      const live = evaluationGet_('evaluationFormConfigs', formId, tx), projected = evaluationGet_('evaluationActivities', formId, tx);
      if (!live || !projected || projected.active !== true || live.configVersion !== configVersion || live.publicationPending !== true ||
          formsEvaluationStable_(formsEvaluationPublicationContext_(live, tx)) !== formsEvaluationStable_(emails)) throw new Error('Público ou configuração mudou durante a publicação.');
      formsEvaluationReleaseGateUnchanged_(releaseProof, projected, live);
      const changes = {status: 'READY', reason: '', publicationPending: false, publishedAudienceHash: formsEvaluationHash_(emails)};
      const writes = [evaluationWrite_('evaluationFormConfigs', formId, changes, live, ['updatedAt', 'accessVerifiedAt']), evaluationWrite_('evaluationActivities', formId, changes, projected, ['updatedAt', 'accessVerifiedAt'])];
      const request = requestId && evaluationGet_('evaluationRequests', requestId, tx);
      if (request && request.type === 'CONFIGURE_ACTIVITY' && request.payload.activityId === formId && request.status === 'CONFIGURATION_PENDING') writes.push(evaluationWrite_('evaluationRequests', requestId, {status: 'READY', result: {status: 'READY', activityId: formId, configVersion: configVersion}}, request, ['processedAt']));
      return {writes: writes, result: {status: 'READY', activityId: formId, configVersion: configVersion}};
    });
  } catch (error) {
    let closureConfirmed = false;
    if (form) { try { closureConfirmed = formsEvaluationCloseForm_(form); } catch (_) {} }
    if (configVersion !== null) { try { formsEvaluationPublicationPending_(formId, configVersion, closureConfirmed, error && error.trainingReleaseBlocked === true); } catch (_) {} }
    return {status: 'CONFIGURATION_PENDING', closureConfirmed: closureConfirmed};
  }
}
function formsEvaluationConfigured_(payload, actorUid, tx) {
  if (!formsEvaluationAdmin_(evaluationGet_('users', actorUid, tx))) throw new Error('Configuração exige administrador autorizado.');
  const protectedIds = String(PropertiesService.getScriptProperties().getProperty('SAHMT_V2_EVALUATION_PROTECTED_FORM_IDS') || '').split(/[\s,;]+/).filter(Boolean);
  if (protectedIds.includes(payload.activityId)) throw new Error('Formulário original protegido: não configurar importação de respostas.');
  const eligibleGroups = Array.isArray(payload.eligibleGroups) ? [...new Set(payload.eligibleGroups)] : [];
  if (!formsEvaluationId_(payload.activityId) || !formsEvaluationId_(payload.creditScopeId) || !Number.isInteger(payload.version) || payload.version < 1 ||
      !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0 || !Array.isArray(payload.eligibleUids) || payload.eligibleUids.length > 500 ||
      eligibleGroups.length > 2 || eligibleGroups.some(function (group) { return !['GENERAL', 'RESTRICTED'].includes(group); }) ||
      (!payload.eligibleUids.length && !eligibleGroups.length)) throw new Error('Confira matéria estável, versão, configuração e público.');
  const projection = evaluationGet_('evaluationActivities', payload.activityId, tx);
  const previous = evaluationGet_('evaluationFormConfigs', payload.activityId, tx);
  if (!projection || !projection.active || !projection.areaIds || !projection.areaIds.includes(payload.managerAreaId)) throw new Error('Formulário precisa de vínculo ativo na área escolhida.');
  if ((previous ? previous.configVersion : 0) !== payload.expectedVersion) throw new Error('A configuração mudou; atualize a página.');
  const assignment = evaluationGet_('evaluationAssignments', payload.managerAreaId, tx);
  if (!assignment || !formsEvaluationActive_(evaluationGet_('users', assignment.uid, tx))) throw new Error('A área precisa de gestor designado com acesso vigente.');
  const eligibleUids = [...new Set(payload.eligibleUids)];
  eligibleUids.forEach(function (uid) { if (!formsEvaluationId_(uid) || !formsEvaluationActive_(evaluationGet_('users', uid, tx))) throw new Error('Público contém perfil ausente ou não aprovado.'); });
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const validFrom = new Date(dateOnly.test(String(payload.validFrom)) ? payload.validFrom + 'T00:00:00-03:00' : payload.validFrom);
  const validUntil = new Date(dateOnly.test(String(payload.validUntil)) ? payload.validUntil + 'T23:59:59.999-03:00' : payload.validUntil);
  if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validUntil.getTime()) || validUntil < validFrom) throw new Error('Vigência inválida.');
  const today = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.validFrom)) ? String(payload.validFrom) : Utilities.formatDate(validFrom, 'America/Sao_Paulo', 'yyyy-MM-dd');
  if (!previous && fromDay < today) throw new Error('Importação histórica exige prévia e decisão administrativa; esta configuração não importa períodos passados.');
  const metadata = formsEvaluationMetadata_(payload.activityId);
  const form = FormApp.openById(payload.activityId);
  if (!form.hasLimitOneResponsePerUser() || form.canEditResponse()) throw new Error('Conferir uma resposta por conta e edição após envio desativada.');
  const checked = formsEvaluationConfiguration_(metadata, payload);
  const materialUrls = payload.materialUrls || formsEvaluationDriveReferences_(metadata).map(function (ref) { return 'https://drive.google.com/file/d/' + ref.id + '/view'; });
  const materialSnapshot = formsEvaluationMaterialSnapshot_(materialUrls);
  const materialFingerprint = formsEvaluationMaterialFingerprint_(materialSnapshot);
  const sameScope = formsEvaluationAll_('evaluationFormConfigs', [firestoreFilter_('creditScopeId', 'EQUAL', {stringValue: payload.creditScopeId})], tx).sort(function (a, b) { return b.version - a.version; });
  const baseline = previous || sameScope[0] || null;
  const materialVersionChanged = baseline && (baseline.materialSnapshot || []).every(formsEvaluationMaterialSnapshotVerified_) && materialSnapshot.every(formsEvaluationMaterialSnapshotVerified_) && baseline.materialFingerprint !== materialFingerprint;
  const currentCriteria = {question: checked.questionFingerprint, material: materialFingerprint, mappedCriteria: formsEvaluationMappedCriteria_(checked.questionSnapshot, checked.mapping), modalities: payload.modalities,
    affirmativeValue: checked.mapping.acknowledgement && checked.mapping.acknowledgement.affirmativeValue || ''};
  const peers = sameScope.filter(function (config) { return config.version === payload.version; });
  if (baseline && baseline.version === payload.version && !peers.some(function (config) { return config.id === baseline.id; })) peers.push(baseline);
  if (peers.some(function (config) {
    const criteria = {question: formsEvaluationSavedQuestionFingerprint_(config), material: config.materialFingerprint,
      mappedCriteria: formsEvaluationMappedCriteria_(config.questionSnapshot, config.mapping), modalities: config.modalities, affirmativeValue: config.mapping && config.mapping.acknowledgement && config.mapping.acknowledgement.affirmativeValue || ''};
    return formsEvaluationHash_(criteria) !== formsEvaluationHash_(currentCriteria);
  })) throw new Error('Alteração de conteúdo, gabarito, pesos ou critérios exige nova versão elegível; não reinterprete respostas da mesma matéria/versão.');
  if (baseline && (payload.version < baseline.version || payload.version > baseline.version && formsEvaluationSavedQuestionFingerprint_(baseline) === checked.questionFingerprint && !materialVersionChanged)) throw new Error('Nova versão exige alteração efetiva; duplicação ou título não gera nova elegibilidade.');
  if (previous && previous.creditScopeId !== payload.creditScopeId) throw new Error('A matéria estável não pode ser trocada para repetir créditos.');
  let ready = form.isAcceptingResponses() && (!form.supportsAdvancedResponderPermissions || !form.supportsAdvancedResponderPermissions() || form.isPublished());
  let reason = ready ? '' : 'Formulário ainda não publicado ou não recebendo respostas; nenhuma leitura histórica será pontuada.';
  let blockedByPriorResponses = false;
  if (previous && payload.version > previous.version) {
    const existing = formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(payload.activityId) + '/responses?pageSize=1');
    if ((existing.responses || []).length) {
      ready = false;
      blockedByPriorResponses = true;
      reason = 'Nova versão deste Form já tem respostas e uma resposta por conta impede repetir o teste. Use uma cópia sem respostas, com a mesma matéria (creditScopeId) e a nova versão elegível; não apague respostas existentes.';
    }
  }
  if (eligibleGroups.length) {
    formsEvaluationCloseForm_(form);
    ready = false;
    if (!blockedByPriorResponses) reason = 'Configuração salva fechada; respondentes precisam de validação antes da publicação.';
  }
  const status = ready ? 'READY' : 'CONFIGURATION_PENDING';
  const configVersion = (previous ? previous.configVersion : 0) + 1;
  const cfg = {id: payload.activityId, formId: payload.activityId, responderUrl: metadata.responderUri || '', creditScopeId: payload.creditScopeId,
    version: payload.version, configVersion: configVersion, status: status, reason: reason, eligibleUids: eligibleUids, eligibleGroups: eligibleGroups, managerAreaId: payload.managerAreaId,
    managerUid: assignment.uid, assignmentId: assignment.id, assignmentVersion: assignment.version, modalities: payload.modalities,
    acknowledgementItemId: checked.mapping.acknowledgement && checked.mapping.acknowledgement.itemId || payload.acknowledgementItemId || '',
    acknowledgementValue: checked.mapping.acknowledgement && checked.mapping.acknowledgement.affirmativeValue || payload.acknowledgementValue || 'SIM',
    suggestionProblemItemId: checked.mapping.problem && checked.mapping.problem.itemId || payload.suggestionProblemItemId || '',
    suggestionProposalItemId: checked.mapping.proposal && checked.mapping.proposal.itemId || payload.suggestionProposalItemId || '',
    suggestionBenefitItemId: checked.mapping.benefit && checked.mapping.benefit.itemId || payload.suggestionBenefitItemId || '',
    mapping: checked.mapping, questionSnapshot: checked.questionSnapshot, questionFingerprint: checked.questionFingerprint, maxTestScore: checked.maxTestScore,
    materialUrls: materialUrls, materialSnapshot: materialSnapshot, materialFingerprint: materialFingerprint,
    previousSnapshot: baseline && payload.version > baseline.version ? {version: baseline.version, questionFingerprint: formsEvaluationSavedQuestionFingerprint_(baseline), questionSnapshot: baseline.questionSnapshot,
      materialFingerprint: baseline.materialFingerprint, materialSnapshot: baseline.materialSnapshot} : previous && previous.previousSnapshot || null,
    validFrom: validFrom, validUntil: validUntil, firstEligibleAt: previous && previous.version === payload.version ? previous.firstEligibleAt : new Date(Math.max(Date.now(), validFrom.getTime())),
    configuredByUid: actorUid, publicationPending: eligibleGroups.length > 0 && !blockedByPriorResponses, updatedAt: new Date()};
  const visible = {creditScopeId: cfg.creditScopeId, version: cfg.version, configVersion: configVersion, title: metadata.info.title,
    eligibleUids: eligibleUids, eligibleGroups: eligibleGroups, managerUid: cfg.managerUid, assignmentId: cfg.assignmentId, managerAreaId: cfg.managerAreaId,
    modalities: cfg.modalities, maxTestScore: cfg.maxTestScore, validFrom: validFrom, validUntil: validUntil, status: status, reason: reason, responderUrl: cfg.responderUrl,
    acknowledgementItemId: cfg.acknowledgementItemId, acknowledgementValue: cfg.acknowledgementValue,
    suggestionProblemItemId: cfg.suggestionProblemItemId, suggestionProposalItemId: cfg.suggestionProposalItemId, suggestionBenefitItemId: cfg.suggestionBenefitItemId,
    materialUrls: cfg.materialUrls, publicationPending: cfg.publicationPending};
  return {writes: [evaluationWrite_('evaluationFormConfigs', cfg.id, cfg, previous, ['updatedAt']),
    evaluationWrite_('evaluationActivities', cfg.id, visible, projection, ['updatedAt'])], result: {status: status, activityId: cfg.id, configVersion: configVersion}};
}
function formsEvaluationResolveIdentity_(metadata, response, profiles) {
  if (!metadata.settings || metadata.settings.emailCollectionType !== 'VERIFIED') return {status: 'NEEDS_REVIEW', reason: 'Origem não oferece e-mail verificado.'};
  const email = String(response.respondentEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {status: 'NEEDS_REVIEW', reason: 'Resposta sem identidade Google verificada.'};
  const matches = profiles.filter(function (profile) { return formsEvaluationActive_(profile) && String(profile.email || '').trim().toLowerCase() === email; });
  if (matches.length !== 1 || !matches[0].id || matches[0].uid !== matches[0].id) return {status: 'NEEDS_REVIEW', reason: 'Identidade ausente, ambígua ou UID inconsistente entre perfis aprovados.'};
  return {status: 'CONFIRMED', uid: matches[0].uid || matches[0].id, identitySource: 'FORMS_VERIFIED_EMAIL'};
}
function formsEvaluationAnswer_(response, mapping) {
  const answer = mapping && (response.answers || {})[mapping.questionId];
  const values = answer && answer.textAnswers && answer.textAnswers.answers || [];
  return values.map(function (entry) { return String(entry.value || '').trim(); }).join('\n');
}
function formsEvaluationParticipation_(metadata, cfg, response, profiles) {
  const identity = formsEvaluationResolveIdentity_(metadata, response, profiles);
  if (identity.status !== 'CONFIRMED') return identity;
  const submittedAt = new Date(response.createTime);
  const eligibleProfile = profiles.find(function (profile) { return (profile.uid || profile.id) === identity.uid; });
  if (cfg.status !== 'READY' || !formsEvaluationEligibleProfile_(cfg, eligibleProfile || {}, null) || !Number.isFinite(submittedAt.getTime()) || submittedAt < cfg.validFrom || submittedAt > cfg.validUntil || submittedAt < cfg.firstEligibleAt) return {status: 'NEEDS_REVIEW', reason: 'Resposta fora da versão, público ou vigência aprovada.'};
  try { formsEvaluationCheckedMapping_(metadata, cfg); }
  catch (_) { return {status: 'NEEDS_REVIEW', reason: 'IDs, opções ou regras dos campos não correspondem à configuração vigente; não interpretar respostas como zero.'}; }
  const currentFingerprint = formsEvaluationQuestionFingerprint_(formsEvaluationQuestionSnapshot_(metadata));
  if (currentFingerprint !== formsEvaluationSavedQuestionFingerprint_(cfg)) return {status: 'NEEDS_REVIEW', reason: 'Itens/gabarito/pesos mudaram sem configuração elegível.'};
  const declaration = cfg.modalities.acknowledgement === true && formsEvaluationAnswer_(response, cfg.mapping.acknowledgement) === cfg.mapping.acknowledgement.affirmativeValue;
  const suggestion = {problem: formsEvaluationAnswer_(response, cfg.mapping.problem), proposal: formsEvaluationAnswer_(response, cfg.mapping.proposal), benefit: formsEvaluationAnswer_(response, cfg.mapping.benefit), status: 'NOT_APPLICABLE'};
  if (cfg.modalities.suggestion === true && [suggestion.problem, suggestion.proposal, suggestion.benefit].some(Boolean)) {
    suggestion.status = [suggestion.problem, suggestion.proposal, suggestion.benefit].every(function (text) { return text.length >= 8; }) && new Set([suggestion.problem, suggestion.proposal, suggestion.benefit].map(function (text) { return text.toLowerCase().replace(/\s+/g, ' '); })).size > 1 ? 'PENDING' : 'INVALID';
  }
  const score = cfg.modalities.test === true && typeof response.totalScore === 'number' && Number.isFinite(response.totalScore) ? response.totalScore : null;
  if (score !== null && (score < 0 || score > cfg.maxTestScore)) return {status: 'NEEDS_REVIEW', reason: 'Nota corrigida está fora dos pesos configurados.'};
  const test = {status: cfg.modalities.test !== true ? 'NOT_APPLICABLE' : score === null ? 'PENDING_GRADE' : 'CONFIRMED', score: score, maxScore: cfg.maxTestScore};
  return {status: test.status === 'PENDING_GRADE' || suggestion.status === 'PENDING' ? 'PENDING' : 'CONFIRMED', uid: identity.uid,
    identitySource: identity.identitySource, activityId: cfg.formId, creditScopeId: cfg.creditScopeId, areaIds: cfg.areaIds || [], managerUid: cfg.managerUid,
    version: cfg.version, responseId: response.responseId, declaration: declaration, suggestion: suggestion, test: test, submittedAt: submittedAt,
    sourceFingerprint: formsEvaluationHash_(response)};
}
function formsEvaluationFormGovernance_(response, cfg, uid, tx) {
  if (!cfg.mapping.review) return {writes: [], projection: null};
  const mapping = cfg.mapping.review;
  const components = formsEvaluationAnswer_(response, mapping.components).split('\n').filter(Boolean);
  if (!components.length) return {writes: [], projection: null};
  const assignment = evaluationGet_('evaluationAssignments', cfg.managerAreaId, tx);
  const previousVersion = Number(formsEvaluationAnswer_(response, mapping.previousVersion));
  const newVersion = Number(formsEvaluationAnswer_(response, mapping.newVersion));
  const summary = formsEvaluationAnswer_(response, mapping.summary);
  const materialEvidence = formsEvaluationAnswer_(response, mapping.materialEvidence).split(/\r?\n/).map(function (url) { return url.trim(); }).filter(Boolean);
  const questionEvidence = formsEvaluationAnswer_(response, mapping.questionEvidence).split(/\r?\n/).map(function (url) { return url.trim(); }).filter(Boolean);
  const valid = assignment && assignment.uid === uid && components.length <= 2 && new Set(components).size === components.length && components.every(function (part) { return ['MATERIAL','QUESTIONS'].includes(part); }) && Number.isInteger(previousVersion) && previousVersion >= 0 && Number.isInteger(newVersion) && newVersion > previousVersion && summary.length >= 8 && [materialEvidence,questionEvidence].every(function (urls) { return urls.length <= 10 && urls.every(function (url) { return /^https:\/\/[^\s]+$/.test(url); }); }) && (components.includes('MATERIAL') ? materialEvidence.length > 0 : !materialEvidence.length) && (components.includes('QUESTIONS') ? questionEvidence.length > 0 : !questionEvidence.length);
  if (!valid) return {writes: [], projection: {status:'NEEDS_REVIEW',reason:'Registro opcional incompleto ou sem designação; ajustar e solicitar validação em Gestão. Nenhum ponto concedido.'}};
  const requestId = 'form-governance-' + formsEvaluationHash_([cfg.formId,response.responseId,uid]);
  const previous = evaluationGet_('evaluationRequests',requestId,tx);
  if (previous) return {writes: [], projection: {status:previous.status,requestId:requestId}};
  const payload = {activityId:cfg.formId,areaId:cfg.managerAreaId,assignmentId:cfg.managerAreaId,previousVersion:previousVersion,newVersion:newVersion,summary:summary,components:components,materialEvidence:materialEvidence,questionEvidence:questionEvidence};
  return {writes:[evaluationWrite_('evaluationRequests',requestId,{id:requestId,type:'REQUEST_GOVERNANCE',actorUid:uid,status:'PENDING',payload:payload,sourceType:'GOOGLE_FORM',sourceId:response.responseId},null,['createdAt'])],projection:{status:'PENDING',requestId:requestId}};
}
function formsEvaluationProcessResponse_(formId, responseId, profilePool) {
  const metadata = formsEvaluationMetadata_(formId);
  const cfg = evaluationGet_('evaluationFormConfigs', formId);
  if (!cfg || cfg.status !== 'READY') return {status: 'CONFIGURATION_PENDING', reason: 'Formulário não configurado.'};
  const response = formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(formId) + '/responses/' + encodeURIComponent(responseId));
  if (response.responseId !== responseId || response.formId && response.formId !== formId) throw new Error('A resposta não corresponde à origem solicitada.');
  const profiles = profilePool || formsEvaluationAll_('users');
  const decoded = formsEvaluationParticipation_(metadata, cfg, response, profiles);
  if (!decoded.uid) {
    const id = 'response-' + formsEvaluationHash_(formId + '\u0000' + responseId);
    const old = evaluationGet_('evaluationLinks', id);
    formsEvaluationWriteRecord_('evaluationLinks', id, {id: id, sourceCollection: 'formsResponses', sourceId: responseId, formId: formId,
      active: false, status: 'NEEDS_REVIEW', reason: decoded.reason}, old);
    return decoded;
  }
  return evaluationRunTransaction_(function (tx) {
    const liveCfg = evaluationGet_('evaluationFormConfigs', formId, tx);
    const activity = evaluationGet_('evaluationActivities', formId, tx);
    const profile = evaluationGet_('users', decoded.uid, tx);
    if (!activity || !liveCfg || liveCfg.status !== 'READY' || activity.active !== true || activity.status !== 'READY' || liveCfg.configVersion !== cfg.configVersion || !formsEvaluationActive_(profile) || String(profile.email || '').trim().toLowerCase() !== String(response.respondentEmail || '').trim().toLowerCase() || !formsEvaluationEligibleProfile_(liveCfg, profile, tx)) return {writes: [], result: {status: 'NEEDS_REVIEW', reason: 'Acesso ou configuração mudou durante a validação.'}};
    // Recheck normalized identity in a complete bounded transaction snapshot, including newly approved profiles.
    const currentProfiles = formsEvaluationAll_('users', [firestoreFilter_('active','EQUAL',{booleanValue:true}),firestoreFilter_('access','EQUAL',{booleanValue:true})], tx);
    const currentIdentity = formsEvaluationResolveIdentity_(metadata, response, currentProfiles);
    if (currentIdentity.status !== 'CONFIRMED' || currentIdentity.uid !== decoded.uid) return {writes:[],result:{status:'NEEDS_REVIEW',reason:'Identidade duplicada ou alterada entre a leitura e a confirmação.'}};
    const id = 'participation-' + formsEvaluationHash_(decoded.uid + '\u0000' + cfg.creditScopeId + '\u0000' + cfg.version);
    const previous = evaluationGet_('evaluationParticipations', id, tx);
    if (previous && previous.responseId !== responseId && previous.activityId !== formId) return {writes: [], result: {status: 'NEEDS_REVIEW', reason: 'Outra origem já possui participação nesta matéria e versão; não repetir crédito.'}};
    if (previous && previous.responseId !== responseId) return {writes: [], result: {status: 'NEEDS_REVIEW', reason: 'Resposta adicional exige revisão; uma participação por matéria/versão.'}};
    if (previous && ['APPROVED', 'REJECTED'].includes(previous.suggestion && previous.suggestion.status)) {
      if (formsEvaluationHash_([decoded.suggestion.problem, decoded.suggestion.proposal, decoded.suggestion.benefit]) !== formsEvaluationHash_([previous.suggestion.problem, previous.suggestion.proposal, previous.suggestion.benefit])) {
        decoded.status = 'NEEDS_REVIEW'; decoded.reason = 'Sugestão mudou após revisão; não reverter decisão administrativa.';
      }
      decoded.suggestion = previous.suggestion;
    }
    decoded.id = id;
    decoded.submittedManagerUid = previous && (previous.submittedManagerUid || previous.managerUid) || decoded.managerUid;
    if (previous && ['APPROVED', 'REJECTED'].includes(previous.suggestion && previous.suggestion.status)) decoded.managerUid = previous.managerUid;
    decoded.areaIds = activity.areaIds || [];
    const changes = [];
    const base = {uid: decoded.uid, category: 'PERFORMANCE', creditScopeId: cfg.creditScopeId, activityId: formId, areaId: cfg.managerAreaId,
      version: cfg.version, sourceType: 'GOOGLE_FORM', sourceId: responseId, sourceFingerprint: decoded.sourceFingerprint,
      approvedByUid: '', evidence: {formId: formId, responseId: responseId, identitySource: decoded.identitySource}};
    if (cfg.modalities.acknowledgement === true) changes.push(Object.assign({}, base, {modality: 'ACKNOWLEDGEMENT', points: decoded.declaration ? 1 : 0, reason: 'Declaração afirmativa do participante; não comprova leitura integral.'}));
    if (decoded.test.status === 'CONFIRMED') changes.push(Object.assign({}, base, {modality: 'TEST', points: decoded.test.score, maxTestScore: decoded.test.maxScore, reason: 'Nota corrigida obtida da API Google Forms.'}));
    const plan = evaluationApplyAwards_(changes, {transaction: tx});
    if (plan.status === 'NEEDS_REVIEW') { decoded.status = 'NEEDS_REVIEW'; decoded.reason = 'Divergência com correção administrativa; pontos preservados.'; }
    const governance = formsEvaluationFormGovernance_(response, liveCfg, decoded.uid, tx);
    if (governance.projection) decoded.governance = governance.projection;
    return {writes: (plan.writes || []).concat(governance.writes, [evaluationWrite_('evaluationParticipations', id, decoded, previous, ['updatedAt'])]), result: {status: decoded.status, participationId: id}};
  });
}

function formsEvaluationReviewerAllowed_(profile, area, assignment, actorUid) {
  if (!formsEvaluationActive_(profile)) return false;
  if (formsEvaluationAdmin_(profile) || (profile.permissions || {}).managementManage === true) return true;
  if (assignment && assignment.uid === actorUid) return true;
  return typeof managementScoreReviewerAllowed_ === 'function' && managementScoreReviewerAllowed_(profile, {managerUids: []}, {reviewerUid: actorUid, managementAreaId: area.id});
}
function formsEvaluationReviewSuggestion_(payload, actorUid, tx) {
  if (!formsEvaluationId_(payload.participationId) || !['APPROVE', 'REJECT'].includes(payload.decision)) throw new Error('Decisão inválida.');
  const participation = evaluationGet_('evaluationParticipations', payload.participationId, tx);
  if (!participation || participation.uid === actorUid || !participation.suggestion || participation.suggestion.status !== 'PENDING') throw new Error('Sugestão não está pendente ou tentativa de autoaprovação.');
  const cfg = evaluationGet_('evaluationFormConfigs', participation.activityId, tx);
  const actor = evaluationGet_('users', actorUid, tx);
  const area = cfg && evaluationGet_('managementAreas', cfg.managerAreaId, tx);
  const assignment = cfg && evaluationGet_('evaluationAssignments', cfg.managerAreaId, tx);
  if (!cfg || !area || !formsEvaluationReviewerAllowed_(actor, area, assignment, actorUid)) throw new Error('Revisor não autorizado para a matéria.');
  const note = String(payload.note || '').trim();
  if (note.length < 8) throw new Error('Descreva a pertinência, originalidade ou motivo da recusa com pelo menos oito caracteres.');
  const suggestion = Object.assign({}, participation.suggestion, {status: payload.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', approvedByUid: actorUid, reviewNote: note});
  const writes = [];
  let status = suggestion.status;
  if (payload.decision === 'APPROVE') {
    if (![suggestion.problem, suggestion.proposal, suggestion.benefit].every(function (text) { return typeof text === 'string' && text.trim().length >= 8; })) throw new Error('Não pontuar contribuições vazias ou incompletas.');
    const change = {uid: participation.uid, category: 'PERFORMANCE', modality: 'SUGGESTION', creditScopeId: participation.creditScopeId,
      activityId: participation.activityId, areaId: cfg.managerAreaId, version: participation.version, points: 2,
      sourceFingerprint: formsEvaluationHash_([suggestion.problem, suggestion.proposal, suggestion.benefit]), sourceType: 'SUGGESTION_REVIEW', sourceId: participation.id,
      approvedByUid: actorUid, reason: note, evidence: {participationId: participation.id, reviewerUid: actorUid}};
    const plan = evaluationApplyAwards_([change], {transaction: tx});
    writes.push.apply(writes, plan.writes || []);
    if (plan.status === 'NEEDS_REVIEW') status = 'NEEDS_REVIEW';
  }
  writes.push(evaluationWrite_('evaluationParticipations', participation.id, {suggestion: suggestion, status: status}, participation, ['updatedAt']));
  return {writes: writes, result: {status: status, participationId: participation.id}};
}
function formsEvaluationGovernanceRequest_(payload, actorUid, tx) {
  if (!formsEvaluationId_(payload.activityId) || !formsEvaluationId_(payload.areaId) || payload.assignmentId !== payload.areaId ||
      !Number.isInteger(payload.previousVersion) || !Number.isInteger(payload.newVersion) || payload.previousVersion < 0 || payload.newVersion <= payload.previousVersion ||
      String(payload.summary || '').trim().length < 8 || !Array.isArray(payload.components) || !payload.components.length ||
      new Set(payload.components).size !== payload.components.length || payload.components.some(function (component) { return !['MATERIAL', 'QUESTIONS'].includes(component); })) throw new Error('Confira matéria, designação, versões, componentes e resumo das alterações.');
  const cfg = evaluationGet_('evaluationFormConfigs', payload.activityId, tx);
  const area = evaluationGet_('managementAreas', payload.areaId, tx);
  const assignment = evaluationGet_('evaluationAssignments', payload.areaId, tx);
  const manager = evaluationGet_('users', actorUid, tx);
  if (!cfg || !area || area.active !== true || !assignment || assignment.uid !== actorUid || !formsEvaluationActive_(manager) || cfg.managerAreaId !== payload.areaId) throw new Error('Somente o gestor designado para a matéria pode solicitar revisão.');
  const baseline = cfg.version === payload.previousVersion ? cfg : cfg.version === payload.newVersion && cfg.previousSnapshot && cfg.previousSnapshot.version === payload.previousVersion ? cfg.previousSnapshot : null;
  const metadata = formsEvaluationMetadata_(payload.activityId);
  const questions = formsEvaluationQuestionSnapshot_(metadata);
  const questionFingerprintAfter = formsEvaluationQuestionFingerprint_(questions);
  const materialEvidence = payload.materialEvidence || [];
  const questionEvidence = payload.questionEvidence || [];
  if (!Array.isArray(questionEvidence) || questionEvidence.length > 10 || questionEvidence.some(function (url) { return !/^https:\/\/[^\s]+$/.test(String(url)); })) throw new Error('Evidências das questões precisam usar URLs HTTPS.');
  if (payload.components.includes('MATERIAL') && !materialEvidence.length || payload.components.includes('QUESTIONS') && !questionEvidence.length || !payload.components.includes('MATERIAL') && materialEvidence.length || !payload.components.includes('QUESTIONS') && questionEvidence.length) throw new Error('Informe evidência para cada componente solicitado.');
  const currentMaterials = formsEvaluationMaterialSnapshot_(cfg.materialUrls || []);
  const materialAfter = materialEvidence.length ? formsEvaluationMaterialSnapshot_(materialEvidence) : [];
  const materialBefore = baseline && baseline.materialSnapshot || [];
  const materialVerified = currentMaterials.concat(materialAfter, materialBefore).every(formsEvaluationMaterialSnapshotVerified_);
  const materialChanged = materialVerified && materialAfter.length > 0 && materialBefore.length > 0 && materialAfter.some(function (current) {
    return !materialBefore.some(function (old) { return old.contentHash === current.contentHash; });
  });
  const questionFingerprintBefore = formsEvaluationSavedQuestionFingerprint_(baseline);
  const questionChanged = Boolean(questionFingerprintBefore && questionFingerprintBefore !== questionFingerprintAfter);
  const relatedMaterialIds = formsEvaluationDriveReferences_({metadata: metadata, materialUrls: cfg.materialUrls}).map(function (ref) { return ref.id; });
  const relatedMaterial = materialAfter.every(function (item) { return relatedMaterialIds.includes(item.fileId); });
  const relatedQuestions = questionEvidence.every(function (url) {
    const link = formsEvaluationLink_(url);
    if (!link) return false;
    if (link.formId === cfg.formId) return true;
    const expected = formsEvaluationLink_(cfg.responderUrl), aliases = {};
    if (expected) aliases[expected.aliasKey] = {formId:cfg.formId};
    try { return formsEvaluationResolve_(link,aliases).formId === cfg.formId; } catch (_) { return false; }
  });
  const changed = {MATERIAL: materialChanged && relatedMaterial, QUESTIONS: questionChanged && relatedQuestions};
  const currentDrive = formsEvaluationGoogleRequest_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(cfg.formId) + '?fields=id,modifiedTime,lastModifyingUser(emailAddress)');
  const effectiveAt = assignment.effectiveAt instanceof Date ? assignment.effectiveAt : new Date(assignment.effectiveAt);
  const managerEmail = String(manager.email || '').trim().toLowerCase();
  const authorship = (!payload.components.includes('MATERIAL') || materialAfter.every(function (item) {
    return item.modifierEmail.toLowerCase() === managerEmail && new Date(item.modifiedTime) >= effectiveAt;
  })) && (!payload.components.includes('QUESTIONS') || String(currentDrive.lastModifyingUser && currentDrive.lastModifyingUser.emailAddress || '').toLowerCase() === managerEmail && new Date(currentDrive.modifiedTime) >= effectiveAt);
  const verifiedChanges = payload.components.every(function (component) { return changed[component]; });
  const status = verifiedChanges && authorship ? 'PENDING' : 'NEEDS_REVIEW';
  const reason = payload.components.includes('MATERIAL') && !materialVerified ? 'MATERIAL contém imagem, desenho ou gráfico nativo sem bytes estáveis verificáveis, ou baseline legado ainda não revalidado; manter NEEDS_REVIEW sem pontos. Questões continuam sendo verificadas independentemente.' : !baseline ? 'Primeiro baseline sem histórico anterior: exige revisão humana e evidências verificáveis.' : !verifiedChanges ? 'Não foi possível comprovar mudança efetiva e pertinente de todos os componentes.' : !authorship ? 'Conferir autoria e vigência da designação antes da aprovação.' : '';
  // Identity excludes the selected components, so approving the second one later cannot duplicate the first credit.
  const revisionId = 'revision-' + formsEvaluationHash_([cfg.creditScopeId, actorUid, payload.areaId, assignment.version, payload.previousVersion, payload.newVersion]);
  const previous = evaluationGet_('evaluationGovernanceRevisions', revisionId, tx);
  if (previous && ((previous.approvedComponents || []).includes('QUESTIONS') && formsEvaluationSavedQuestionFingerprint_(previous, 'questionSnapshotAfter', 'questionFingerprintAfter') !== questionFingerprintAfter || (previous.approvedComponents || []).includes('MATERIAL') && previous.materialContentFingerprintAfter !== formsEvaluationMaterialFingerprint_(currentMaterials))) throw new Error('A revisão efetiva mudou; registre outra versão elegível em vez de alterar a mesma revisão.');
  if (previous && payload.components.every(function (component) { return (previous.components || []).includes(component); })) return {writes: [], result: {status: previous.status, revisionId: revisionId, duplicate: true}};
  const alreadyApproved = previous && previous.approvedComponents || [];
  const verified = [...new Set((previous && previous.verifiedComponents || []).concat(Object.keys(changed).filter(function (key) { return changed[key]; })))];
  const components = [...new Set((previous && previous.components || []).concat(payload.components))];
  const record = {id: revisionId, uid: actorUid, activityId: cfg.formId, creditScopeId: cfg.creditScopeId, areaId: payload.areaId,
    assignmentId: assignment.id, assignmentVersion: assignment.version, previousVersion: payload.previousVersion, newVersion: payload.newVersion,
    summary: String(payload.summary).trim(), materialEvidence: materialEvidence.length ? materialEvidence : previous && previous.materialEvidence || [], questionEvidence: questionEvidence.length ? questionEvidence : previous && previous.questionEvidence || [],
    materialFingerprintBefore: formsEvaluationMaterialFingerprint_(materialBefore), materialFingerprintAfter: materialAfter.length ? formsEvaluationMaterialFingerprint_(materialAfter) : previous && previous.materialFingerprintAfter || formsEvaluationHash_([]),
    materialContentFingerprintAfter: formsEvaluationMaterialFingerprint_(currentMaterials),
    questionFingerprintBefore: questionFingerprintBefore, questionFingerprintAfter: questionFingerprintAfter,
    materialSnapshotBefore: materialBefore, materialSnapshotAfter: materialAfter.length ? materialAfter : previous && previous.materialSnapshotAfter || [], questionSnapshotBefore: baseline && baseline.questionSnapshot || [], questionSnapshotAfter: questions,
    components: components, approvedComponents: alreadyApproved, verifiedComponents: verified,
    status: status, reason: reason, authorshipVerified: authorship && (!previous || previous.authorshipVerified === true), approvedByUid: previous && previous.approvedByUid || '', createdAt: previous ? previous.createdAt : new Date(), updatedAt: new Date()};
  const duplicates = formsEvaluationComponentDuplicates_(record,tx);
  if (duplicates.length) { record.status = 'NEEDS_REVIEW'; record.reason = 'Este conteúdo de ' + duplicates.join('/') + ' já foi aprovado nesta matéria; nova numeração, cópia, área, designação ou renomeação não gera outro crédito.'; record.verifiedComponents = record.verifiedComponents.filter(function (component) { return !duplicates.includes(component); }); }
  return {writes: [evaluationWrite_('evaluationGovernanceRevisions', revisionId, record, previous, previous ? ['updatedAt'] : ['createdAt', 'updatedAt'])], result: {status: record.status, revisionId: revisionId}};
}
function formsEvaluationReviewGovernance_(payload, actorUid, tx) {
  const actor = evaluationGet_('users', actorUid, tx);
  const revision = evaluationGet_('evaluationGovernanceRevisions', payload.revisionId, tx);
  if (!formsEvaluationAdmin_(actor) || !revision || revision.uid === actorUid || !['APPROVE', 'REJECT'].includes(payload.decision)) throw new Error('Revisão exige administrador distinto do beneficiário.');
  if (!['PENDING', 'NEEDS_REVIEW'].includes(revision.status)) throw new Error('Revisão não está pendente.');
  const note = String(payload.note || '').trim();
  if (note.length < 8 || revision.status === 'NEEDS_REVIEW' && note.length < 20) throw new Error('Registre a conferência das evidências e a justificativa da decisão.');
  const historyId = 'assignment-' + formsEvaluationHash_(revision.areaId + '\u0000' + revision.assignmentVersion);
  const assignment = evaluationGet_('evaluationAssignmentHistory', historyId, tx);
  if (!assignment || assignment.uid !== revision.uid || !formsEvaluationActive_(evaluationGet_('users', revision.uid, tx))) throw new Error('Designação histórica ou beneficiário inválido.');
  const writes = [];
  const approved = revision.approvedComponents || [];
  let status = payload.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (payload.decision === 'APPROVE') {
    const duplicates = formsEvaluationComponentDuplicates_(revision,tx);
    if (duplicates.length) return {writes:[evaluationWrite_('evaluationGovernanceRevisions',revision.id,{status:'NEEDS_REVIEW',reason:'Componente e conteúdo já aprovados em outra designação; crédito anterior preservado.'},revision,['updatedAt'])],result:{status:'NEEDS_REVIEW',revisionId:revision.id}};
    const currentQuestions = formsEvaluationQuestionFingerprint_(formsEvaluationQuestionSnapshot_(formsEvaluationMetadata_(revision.activityId)));
    const currentMaterials = formsEvaluationMaterialSnapshot_(revision.materialEvidence || []);
    if (revision.components.includes('QUESTIONS') && currentQuestions !== formsEvaluationSavedQuestionFingerprint_(revision, 'questionSnapshotAfter', 'questionFingerprintAfter') || revision.components.includes('MATERIAL') && formsEvaluationMaterialFingerprint_(currentMaterials) !== revision.materialFingerprintAfter) throw new Error('As evidências mudaram após a solicitação; atualize a revisão.');
    if (revision.components.includes('MATERIAL') && !currentMaterials.concat(revision.materialSnapshotBefore || [], revision.materialSnapshotAfter || []).every(formsEvaluationMaterialSnapshotVerified_)) throw new Error('Material nativo sem bytes estáveis verificáveis: preservar como NEEDS_REVIEW sem conceder ponto.');
    if (!revision.components.every(function (component) { return (revision.verifiedComponents || []).includes(component); })) throw new Error('Faltam snapshots que comprovem alteração efetiva; preservar como NEEDS_REVIEW.');
    const changes = revision.components.filter(function (component) { return !approved.includes(component); }).map(function (component) {
      return {uid: revision.uid, category: 'GOVERNANCE', modality: component, creditScopeId: revision.id, activityId: revision.activityId,
        areaId: revision.areaId, version: revision.newVersion, points: 1, sourceFingerprint: formsEvaluationHash_(component === 'MATERIAL' ? [revision.materialFingerprintBefore, revision.materialFingerprintAfter] : [revision.questionFingerprintBefore, revision.questionFingerprintAfter]),
        sourceType: 'GOVERNANCE_REVIEW', sourceId: revision.id, approvedByUid: actorUid, reason: note,
        evidence: {revisionId: revision.id, assignmentId: revision.assignmentId, assignmentVersion: revision.assignmentVersion, component: component}};
    });
    const plan = evaluationApplyAwards_(changes, {transaction: tx});
    writes.push.apply(writes, plan.writes || []);
    if (plan.status === 'NEEDS_REVIEW') status = 'NEEDS_REVIEW';
    else revision.components.forEach(function (component) { if (!approved.includes(component)) approved.push(component); });
  }
  writes.push(evaluationWrite_('evaluationGovernanceRevisions', revision.id, {status: status, approvedComponents: approved, approvedByUid: actorUid,
    reviewNote: note, manualAuthorshipVerification: payload.decision === 'APPROVE' && revision.authorshipVerified !== true}, revision, ['updatedAt']));
  return {writes: writes, result: {status: status, revisionId: revision.id}};
}
function formsEvaluationProcessRequest_(request) {
  const type = request.type;
  const payload = request.payload || {};
  if (type === 'CORRECT_SCORE') { evaluationAssertOperator_(true); return evaluationProcessScoreCorrection_(request); }
  if (type === 'RECONCILE_LINKS') {
    const actor = evaluationGet_('users', request.actorUid);
    if (!formsEvaluationActive_(actor) || !(formsEvaluationAdmin_(actor) || ['managementManage','qualityManage','trainingsManage','documentsManage'].some(function (permission) { return (actor.permissions || {})[permission] === true; }))) throw new Error('Reconciliação exige permissão vigente de administração ou gestão da origem.');
    const result = formsEvaluationReconcileLinks_();
    return {status: result.failures.length ? 'NEEDS_REVIEW' : 'CONFIRMED', result: result};
  }
  if (type === 'REVIEW_SUGGESTION' || type === 'REVIEW_GOVERNANCE') evaluationAssertOperator_(true);
  const result = evaluationRunTransaction_(function (tx) {
    const live = evaluationGet_('evaluationRequests', request.id, tx);
    if (!live || live.status !== 'PENDING') return {writes: [], result: {status: live ? live.status : 'NEEDS_REVIEW'}};
    const actor = evaluationGet_('users', live.actorUid, tx);
    if (!formsEvaluationActive_(actor)) throw new Error('Solicitante sem acesso vigente.');
    let plan;
    const livePayload = live.payload || {};
    if (live.type === 'ASSIGN_MANAGER') plan = formsEvaluationAssignments_(livePayload, live.actorUid, tx);
    else if (live.type === 'CONFIGURE_ACTIVITY') plan = formsEvaluationConfigured_(livePayload, live.actorUid, tx);
    else if (live.type === 'REVIEW_SUGGESTION') plan = formsEvaluationReviewSuggestion_(livePayload, live.actorUid, tx);
    else if (live.type === 'REQUEST_GOVERNANCE') plan = formsEvaluationGovernanceRequest_(livePayload, live.actorUid, tx);
    else if (live.type === 'REVIEW_GOVERNANCE') plan = formsEvaluationReviewGovernance_(livePayload, live.actorUid, tx);
    else throw new Error('Tipo de solicitação desconhecido.');
    plan.writes.push(evaluationWrite_('evaluationRequests', live.id, {status: plan.result.status, result: plan.result}, live, ['processedAt']));
    return plan;
  });
  if (type === 'CONFIGURE_ACTIVITY' && Array.isArray(payload.eligibleGroups) && payload.eligibleGroups.length && result.status === 'CONFIGURATION_PENDING') return formsEvaluationFinalizePublication_(payload.activityId, request.id);
  return result;
}
function processEvaluationRequests() {
  evaluationAssertOperator_(false);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING'};
  try {
    const properties = PropertiesService.getScriptProperties(), cursorKey = 'SAHMT_V2_EVALUATION_REQUEST_CURSOR';
    let cursor = null;
    try {
      const value = JSON.parse(properties.getProperty(cursorKey) || 'null');
      if (value && formsEvaluationId_(value.id) && typeof value.createdAt === 'string' && Number.isFinite(new Date(value.createdAt).getTime())) cursor = value;
      else if (value) properties.deleteProperty(cursorKey);
    } catch (_) { properties.deleteProperty(cursorKey); }
    const filters = [firestoreFilter_('status', 'EQUAL', {stringValue: 'PENDING'})];
    const order = [{fieldPath: 'createdAt', direction: 'ASCENDING'}, {fieldPath: '__name__', direction: 'ASCENDING'}];
    const start = cursor ? {values: [{timestampValue: cursor.createdAt}, {referenceValue: firestoreDocumentName_('evaluationRequests', cursor.id)}], before: false} : null;
    let requests = evaluationQuery_('evaluationRequests', filters, order, SAHMT_V2_EVALUATION_FORMS.maxRequests, null, null, start);
    // Wrap only after reaching the end. Old retryable requests keep PENDING and cannot monopolize every run.
    if (!requests.length && cursor) { properties.deleteProperty(cursorKey); requests = evaluationQuery_('evaluationRequests', filters, order, SAHMT_V2_EVALUATION_FORMS.maxRequests); }
    const result = {processed: 0, failed: 0, pending: 0};
    requests.forEach(function (request) {
      try {
        const processed = formsEvaluationProcessRequest_(request);
        if (request.type === 'CORRECT_SCORE' || request.type === 'RECONCILE_LINKS') {
          const live = evaluationGet_('evaluationRequests', request.id);
          if (live && live.status === 'PENDING') formsEvaluationWriteRecord_('evaluationRequests', request.id, {status: processed.status || 'CONFIRMED', result: processed}, live);
        }
        result.processed++;
      } catch (error) {
        const live = evaluationGet_('evaluationRequests', request.id);
        const retry = [409, 429, 500, 502, 503, 504].includes(error.status) || /Ativação bloqueada|Homologação e ativação pendentes/.test(String(error.message || error));
        if (live && live.status === 'PENDING') formsEvaluationWriteRecord_('evaluationRequests', request.id, {status: retry ? 'PENDING' : 'NEEDS_REVIEW', reason: String(error.message || error).slice(0, 300)}, live);
        if (retry) result.pending++; else result.failed++;
      }
      const createdAt = new Date(request.createdAt);
      if (Number.isFinite(createdAt.getTime())) properties.setProperty(cursorKey, JSON.stringify({id: request.id, createdAt: createdAt.toISOString()}));
    });
    return result;
  } finally { lock.releaseLock(); }
}
function onEvaluationFormSubmit(event) {
  evaluationAssertOperator_(true);
  if (!event || !event.response || !event.source || typeof event.response.getId !== 'function' || typeof event.source.getId !== 'function') throw new Error('Exige gatilho instalável do formulário; valores do navegador não são aceitos.');
  return formsEvaluationProcessResponse_(event.source.getId(), event.response.getId());
}
function reconcileEvaluationResponderAccess() {
  evaluationAssertOperator_(false);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING'};
  try {
    const configs = formsEvaluationAll_('evaluationFormConfigs').filter(function (cfg) { return Array.isArray(cfg.eligibleGroups) && cfg.eligibleGroups.length && (cfg.status === 'READY' || cfg.publicationPending === true); });
    const properties = PropertiesService.getScriptProperties(), cursorKey = 'SAHMT_V2_EVALUATION_ACCESS_CURSOR', cursor = properties.getProperty(cursorKey) || '';
    const ordered = configs.filter(function (cfg) { return cfg.id > cursor; }).concat(configs.filter(function (cfg) { return cfg.id <= cursor; }));
    const result = {checked: 0, ready: 0, pending: 0};
    ordered.slice(0, 5).forEach(function (cfg) {
      const outcome = formsEvaluationFinalizePublication_(cfg.id);
      result.checked++;
      if (outcome.status === 'READY') result.ready++; else result.pending++;
      properties.setProperty(cursorKey, cfg.id);
    });
    return result;
  } finally { lock.releaseLock(); }
}
function reconcileEvaluationResponses() {
  evaluationAssertOperator_(true);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING'};
  try {
    const configs = formsEvaluationAll_('evaluationFormConfigs').filter(function (cfg) { return cfg.status === 'READY'; });
    const properties = PropertiesService.getScriptProperties();
    const last = properties.getProperty('SAHMT_V2_EVALUATION_FORM_CURSOR') || '';
    const ordered = configs.filter(function (cfg) { return cfg.id > last; }).concat(configs.filter(function (cfg) { return cfg.id <= last; }));
    const outcomes = {responses: 0, pending: 0, errors: 0};
    let profilePool = null;
    ordered.slice(0, 5).forEach(function (cfg) {
      try {
        const cursorKey = 'SAHMT_V2_EVALUATION_RESPONSE_PAGE_' + cfg.formId;
        const pageToken = properties.getProperty(cursorKey) || '';
        const filter = 'timestamp >= ' + new Date(cfg.firstEligibleAt).toISOString();
        const page = formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(cfg.formId) + '/responses?pageSize=' + SAHMT_V2_EVALUATION_FORMS.maxResponses + '&filter=' + encodeURIComponent(filter) + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
        (page.responses || []).forEach(function (response) {
          if (!profilePool) profilePool = formsEvaluationAll_('users');
          const result = formsEvaluationProcessResponse_(cfg.formId, response.responseId, profilePool);
          outcomes.responses++;
          if (result.status !== 'CONFIRMED') outcomes.pending++;
        });
        if (page.nextPageToken) properties.setProperty(cursorKey, page.nextPageToken); else properties.deleteProperty(cursorKey);
        properties.setProperty('SAHMT_V2_EVALUATION_FORM_CURSOR', cfg.id);
      } catch (error) { outcomes.errors++; }
    });
    return outcomes;
  } finally { lock.releaseLock(); }
}
function reconciliarAvaliacaoSahmtV2() {
  evaluationAssertOperator_(true);
  const result = {};
  function step(name, callback) {
    try { result[name] = callback(); }
    catch (error) { result[name] = {status:'PENDING',reason:String(error.message || error).slice(0,300)}; }
  }
  step('requests',processEvaluationRequests);
  step('responders',reconcileEvaluationResponderAccess);
  step('responses',reconcileEvaluationResponses);
  step('checklistResponsibilities',reconcileChecklistResponsibilities);
  // Categories bootstrap and publish independently. A failure never confirms a partial projection or blocks the other category.
  ['PERFORMANCE','GOVERNANCE'].forEach(function (category) {
    step(category, function () { initializeEvaluationCategoryState_(category); return evaluationPublishCategorySummary_(category); });
  });
  return result;
}
function installEvaluationTriggers() {
  evaluationAssertOperator_(true);
  const configs = formsEvaluationAll_('evaluationFormConfigs').filter(function (cfg) { return cfg.status === 'READY'; });
  const existing = ScriptApp.getProjectTriggers();
  const forms = existing.filter(function (trigger) { return trigger.getHandlerFunction() === 'onEvaluationFormSubmit'; }).map(function (trigger) { return trigger.getTriggerSourceId(); });
  let available = Math.max(0, 20 - existing.length - ['reconciliarAvaliacaoSahmtV2', 'reconcileEvaluationLinks'].filter(function (handler) { return !existing.some(function (trigger) { return trigger.getHandlerFunction() === handler; }); }).length);
  const pollingOnly = [];
  configs.forEach(function (cfg) {
    if (forms.includes(cfg.formId)) return;
    if (available <= 0) { pollingOnly.push(cfg.formId); return; }
    ScriptApp.newTrigger('onEvaluationFormSubmit').forForm(FormApp.openById(cfg.formId)).onFormSubmit().create(); forms.push(cfg.formId); available--;
  });
  ['reconciliarAvaliacaoSahmtV2', 'reconcileEvaluationLinks'].forEach(function (handler) {
    if (!existing.some(function (trigger) { return trigger.getHandlerFunction() === handler; })) ScriptApp.newTrigger(handler).timeBased().everyMinutes(handler === 'reconcileEvaluationLinks' ? 15 : 5).create();
  });
  return {installed: true, formTriggers: forms.length, pollingOnly: pollingOnly, reason: pollingOnly.length ? 'Limite de gatilhos: reconciliação periódica mantém processamento dos demais formulários.' : ''};
}

function formsEvaluationTemplateSpecs_() {
  function header(marker, title, help) { return {marker: marker, kind: 'HEADER', title: marker + ' ' + title, description: help}; }
  function paragraph(marker, title, help) { return {marker: marker, kind: 'PARAGRAPH', title: marker + ' ' + title, description: help}; }
  return [
    header('[SAHMT:IDENTIFICATION]', 'Identificação, versão e critérios', 'O administrador registra matéria, versão e critérios. E-mail da conta Google é coletado automaticamente; não informar UID/e-mail livre como identidade.'),
    header('[SAHMT:MATERIAL]', 'Material de apoio', 'Vincular vídeo, PDF, Docs ou planilhas autorizados. Modelo permanece não publicado até material real e critérios completos.'),
    {marker: SAHMT_V2_EVALUATION_FORMS.markers.ack, kind: 'RADIO', title: SAHMT_V2_EVALUATION_FORMS.markers.ack + ' Declaro leitura ou visualização e ciência do conteúdo', required: true, options: ['SIM', 'NÃO'], description: 'SIM:1 ponto de desempenho após validação. Declaração do participante; não comprova leitura integral.'},
    header('[SAHMT:SUGGESTION]', 'Sugestão opcional', 'Contribuição válida e pertinente:2 pontos de desempenho somente após aprovação independente da gestão, uma por matéria/versão. Não exige implementação.'),
    paragraph(SAHMT_V2_EVALUATION_FORMS.markers.problem, 'Problema identificado', 'Opcional; descreva situação relacionada à matéria.'),
    paragraph(SAHMT_V2_EVALUATION_FORMS.markers.proposal, 'Proposta', 'Opcional; explique a contribuição.'),
    paragraph(SAHMT_V2_EVALUATION_FORMS.markers.benefit, 'Benefício esperado', 'Opcional; explique o resultado esperado.'),
    header('[SAHMT:REVIEW]', 'Registro opcional de revisão pelo gestor', 'Material1, questões1, ambos2 exclusivamente em governança. Designação, alteração efetiva, versões, evidência e aprovação administrativa independente são obrigatórias; pedido não concede pontos.'),
    {marker: '[SAHMT:REVIEW_COMPONENTS]', kind: 'CHECKBOX', title: '[SAHMT:REVIEW_COMPONENTS] Componentes alterados', required: false, options: ['MATERIAL', 'QUESTIONS'], description: ''},
    paragraph('[SAHMT:PREVIOUS_VERSION]', 'Versão anterior', 'Opcional: registrar versão de referência.'),
    paragraph('[SAHMT:NEW_VERSION]', 'Nova versão', 'Opcional: registrar versão após alteração efetiva.'),
    paragraph('[SAHMT:CHANGE_SUMMARY]', 'Resumo das mudanças', 'Descrever alterações; renomeação ou reenvio não pontua.'),
    paragraph('[SAHMT:MATERIAL_EVIDENCE]', 'Evidências de materiais', 'URLs HTTPS dos arquivos alterados, uma por linha.'),
    paragraph('[SAHMT:QUESTION_EVIDENCE]', 'Evidências de questões', 'URL do formulário e referências da alteração, uma por linha.')
  ];
}
function formsEvaluationTemplateMatches_(metadata, specs) {
  const matches = {};
  specs.forEach(function (spec) {
    const found = (metadata.items || []).filter(function (item) { return String(item.title || '').startsWith(spec.marker); });
    if (found.length > 1) throw new Error('Marcador duplicado no modelo: ' + spec.marker + '. Nenhum campo será alterado.');
    if (!found.length) return;
    const item = found[0], question = item.questionItem && item.questionItem.question;
    const compatible = spec.kind === 'HEADER' ? !!item.textItem && !question : question && (spec.kind === 'PARAGRAPH' ? question.textQuestion && question.textQuestion.paragraph === true : question.choiceQuestion && question.choiceQuestion.type === spec.kind);
    if (!compatible) throw new Error('Tipo incompatível no modelo: ' + spec.marker + '. Nenhum campo será alterado.');
    if (!formsEvaluationId_(item.itemId) || question && !formsEvaluationId_(question.questionId)) throw new Error('ID ausente no campo ' + spec.marker + '; conferir o modelo antes de repetir.');
    if (question && Number(question.grading && question.grading.pointValue || 0) !== 0) throw new Error('Campo auxiliar pontuado no modelo: ' + spec.marker + '. Revisão manual necessária.');
    matches[spec.marker] = item;
  });
  return matches;
}
function formsEvaluationTemplateOriginalItems_(metadata, specs) {
  // contentUri is an expiring, server-generated image URL; all authored content and IDs remain in the comparison.
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).filter(function (key) { return key !== 'contentUri'; }).forEach(function (key) { result[key] = stable(value[key]); });
    return result;
  }
  return (metadata.items || []).filter(function (item) { return !specs.some(function (spec) { return String(item.title || '').startsWith(spec.marker); }); }).map(stable);
}
function formsEvaluationTemplateItem_(spec, old) {
  const item = {title: spec.title, description: spec.description};
  if (old) item.itemId = old.itemId;
  if (spec.kind === 'HEADER') item.textItem = {};
  else {
    const question = {required: spec.required === true};
    if (old) question.questionId = old.questionItem.question.questionId;
    if (spec.kind === 'PARAGRAPH') question.textQuestion = {paragraph: true};
    else question.choiceQuestion = {type: spec.kind, options: spec.options.map(function (value) { return {value: value}; })};
    // Ungraded auxiliary fields contribute zero. Grading requires an answer key in the REST schema.
    item.questionItem = {question: question};
  }
  return item;
}
function formsEvaluationTemplateBatch_(metadata, specs) {
  if (typeof metadata.revisionId !== 'string' || !metadata.revisionId.trim()) throw new Error('Revisão Forms ausente; nenhum campo será alterado.');
  const matches = formsEvaluationTemplateMatches_(metadata, specs), virtual = (metadata.items || []).slice();
  const requests = [{updateSettings: {settings: {emailCollectionType: 'VERIFIED', quizSettings: {isQuiz: true}}, updateMask: 'emailCollectionType,quizSettings.isQuiz'}}];
  const prefix = '[SAHMT:TEMPLATE] Ciência, sugestões aprovadas e testes pontuam DESEMPENHO. Revisões do gestor pontuam exclusivamente GOVERNANÇA. Solicitar revisão não concede pontos. Ciência é declaração do participante e não prova leitura integral. Configurar matéria, versão, vigência, público, materiais e IDs reais antes de publicar.';
  const description = String(metadata.info && metadata.info.description || '');
  if (!description.startsWith('[SAHMT:TEMPLATE]')) requests.push({updateFormInfo: {info: {description: prefix + '\n\n' + description}, updateMask: 'description'}});
  specs.forEach(function (spec) {
    const old = matches[spec.marker], item = formsEvaluationTemplateItem_(spec, old);
    if (old) {
      // Explicit grading mask clears a partial native quiz field without changing either stable ID.
      const questionMask = spec.kind === 'PARAGRAPH' ? 'textQuestion' : 'choiceQuestion';
      requests.push({updateItem: {item: item, location: {index: virtual.indexOf(old)}, updateMask: 'title,description' + (spec.kind === 'HEADER' ? '' : ',questionItem.question.required,questionItem.question.' + questionMask + ',questionItem.question.grading')}});
    } else {
      requests.push({createItem: {item: item, location: {index: 0}}});
      virtual.unshift(item); matches[spec.marker] = item;
    }
  });
  const auxiliary = specs.map(function (spec) { return matches[spec.marker]; });
  const originals = virtual.filter(function (item) { return !auxiliary.includes(item); });
  const ordered = auxiliary.slice(0, 3).concat(originals, auxiliary.slice(3));
  ordered.forEach(function (item, target) {
    const from = virtual.indexOf(item);
    if (from !== target) { requests.push({moveItem: {originalLocation: {index: from}, newLocation: {index: target}}}); virtual.splice(from, 1); virtual.splice(target, 0, item); }
  });
  return {requests: requests, writeControl: {requiredRevisionId: metadata.revisionId}};
}
function formsEvaluationVerifyTemplate_(before, after, specs, form) {
  const previous = formsEvaluationTemplateMatches_(before, specs), current = formsEvaluationTemplateMatches_(after, specs);
  specs.forEach(function (spec) {
    const item = current[spec.marker];
    if (!item) throw new Error('Campo não confirmado no modelo: ' + spec.marker + '. Modelo permanece fechado.');
    const question = item.questionItem && item.questionItem.question;
    if (item.title !== spec.title || String(item.description || '') !== spec.description || question && (question.required === true) !== (spec.required === true) || question && question.grading && (question.grading.correctAnswers || question.grading.whenRight || question.grading.whenWrong || question.grading.generalFeedback)) throw new Error('Campo auxiliar divergente: ' + spec.marker + '. Modelo permanece fechado.');
    if (spec.options && (formsEvaluationStable_((question.choiceQuestion.options || []).map(function (option) { return option.value; })) !== formsEvaluationStable_(spec.options) || question.choiceQuestion.shuffle === true || question.choiceQuestion.options.some(function (option) { return option.isOther === true || option.goToSectionId || option.goToAction; }))) throw new Error('Opções divergentes: ' + spec.marker + '. Modelo permanece fechado.');
    if (previous[spec.marker] && (previous[spec.marker].itemId !== item.itemId || question && previous[spec.marker].questionItem.question.questionId !== question.questionId)) throw new Error('Identidade do campo alterada: ' + spec.marker + '. Modelo permanece fechado.');
  });
  if (formsEvaluationStable_(formsEvaluationTemplateOriginalItems_(before, specs)) !== formsEvaluationStable_(formsEvaluationTemplateOriginalItems_(after, specs))) throw new Error('Conferir questões ROPs; modelo permanece fechado e não publicado.');
  const ids = (after.items || []).map(function (item) { return item.itemId; });
  const expectedOrder = specs.slice(0, 3).map(function (spec) { return current[spec.marker].itemId; }).concat(formsEvaluationTemplateOriginalItems_(before, specs).map(function (item) { return item.itemId; }), specs.slice(3).map(function (spec) { return current[spec.marker].itemId; }));
  if (formsEvaluationStable_(ids) !== formsEvaluationStable_(expectedOrder)) throw new Error('Ordem dos campos não confirmada; modelo permanece fechado.');
  const questionIds = (after.items || []).filter(function (item) { return item.questionItem; }).map(function (item) { return item.questionItem.question.questionId; });
  if (new Set(ids).size !== ids.length || new Set(questionIds).size !== questionIds.length) throw new Error('IDs duplicados no modelo; conferir antes de publicar.');
  if (!after.settings || after.settings.emailCollectionType !== 'VERIFIED' || !after.settings.quizSettings || after.settings.quizSettings.isQuiz !== true || form.isAcceptingResponses() || form.canEditResponse() || !form.hasLimitOneResponsePerUser() || form.getResponses().length || form.supportsAdvancedResponderPermissions && form.supportsAdvancedResponderPermissions() && form.isPublished()) throw new Error('Fechamento ou configuração do modelo não confirmado; nenhuma publicação foi autorizada.');
}
function prepareEvaluationTemplate(templateFormId, originalFormId) {
  evaluationAssertOperator_(false);
  if (!formsEvaluationId_(templateFormId) || !formsEvaluationId_(originalFormId) || templateFormId === originalFormId) throw new Error('Use somente a cópia reutilizável, distinta do original protegido.');
  const protectedIds = String(PropertiesService.getScriptProperties().getProperty('SAHMT_V2_EVALUATION_PROTECTED_FORM_IDS') || '').split(/[\s,;]+/).filter(Boolean);
  if (protectedIds.includes(templateFormId)) throw new Error('O modelo informado está na lista de originais protegidos.');
  const form = FormApp.openById(templateFormId);
  if (form.getResponses().length) throw new Error('O modelo possui respostas; nenhuma alteração será realizada.');
  const specs = formsEvaluationTemplateSpecs_(), before = formsEvaluationMetadata_(templateFormId);
  formsEvaluationTemplateMatches_(before, specs);
  form.setAcceptingResponses(false).setAllowResponseEdits(false).setLimitOneResponsePerUser(true).setCollectEmail(true).setPublishingSummary(false).setIsQuiz(true);
  if (form.supportsAdvancedResponderPermissions && form.supportsAdvancedResponderPermissions()) form.setPublished(false);
  // Native flags advance the revision. Read again before making the single conditional content update.
  const fresh = formsEvaluationMetadata_(templateFormId);
  if (formsEvaluationStable_(formsEvaluationTemplateOriginalItems_(before, specs)) !== formsEvaluationStable_(formsEvaluationTemplateOriginalItems_(fresh, specs)) || form.getResponses().length) throw new Error('Modelo alterado durante a preparação; conferir e repetir com o modelo fechado.');
  const batch = formsEvaluationTemplateBatch_(fresh, specs);
  formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(templateFormId) + ':batchUpdate', {method: 'post', contentType: 'application/json', payload: JSON.stringify(batch)});
  const after = formsEvaluationMetadata_(templateFormId);
  formsEvaluationVerifyTemplate_(before, after, specs, FormApp.openById(templateFormId));
  return {prepared: true, published: false, questionsPreserved: formsEvaluationQuestionSnapshot_({items: formsEvaluationTemplateOriginalItems_(before, specs)}).length, mapping: formsEvaluationConfiguration_(after, {modalities: {acknowledgement: true, suggestion: true, test: false}}).mapping};
}

function configurarModeloAvaliacaoSahmtV2() {
  const originalId = '1NFqJHXOiHInHtQlmZMOTKHgjgmeYB4TxJ9s2p8xRTmc';
  const templateId = '1z-T7EL_FN1blDQa9Cn8SybHV_pJOr1dnVObVtHXtcmc';
  evaluationAssertOperator_(false);
  const properties = PropertiesService.getScriptProperties();
  const protectedIds = String(properties.getProperty('SAHMT_V2_EVALUATION_PROTECTED_FORM_IDS') || '').split(/[\s,;]+/).filter(Boolean);
  if (!protectedIds.includes(originalId)) protectedIds.push(originalId);
  properties.setProperty('SAHMT_V2_EVALUATION_PROTECTED_FORM_IDS', protectedIds.join(','));
  const result = prepareEvaluationTemplate(templateId, originalId);
  Logger.log(JSON.stringify({prepared: result.prepared, published: result.published, questionsPreserved: result.questionsPreserved, auxiliaryFields: 14}));
  return result;
}

/** Read actual test inputs without enabling evaluation, processing responses or changing any Google Form. */
function capturarHomologacaoAvaliacaoSahmtV2() {
  const operatorEmail = evaluationAssertOperator_(false);
  const properties = PropertiesService.getScriptProperties();
  const formId = String(properties.getProperty('SAHMT_V2_EVALUATION_HOMOLOGATION_FORM_ID') || '').trim();
  const protectedIds = ['1NFqJHXOiHInHtQlmZMOTKHgjgmeYB4TxJ9s2p8xRTmc', '1z-T7EL_FN1blDQa9Cn8SybHV_pJOr1dnVObVtHXtcmc']
    .concat(String(properties.getProperty('SAHMT_V2_EVALUATION_PROTECTED_FORM_IDS') || '').split(/[\s,;]+/).filter(Boolean));
  if (!formsEvaluationId_(formId) || protectedIds.includes(formId)) throw new Error('Informe somente o ID de uma cópia de homologação; original e modelo estão protegidos.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'PENDING', reason: 'Outro processamento está em execução.'};
  try {
    const cfg = evaluationGet_('evaluationFormConfigs', formId);
    const activity = evaluationGet_('evaluationActivities', formId);
    if (!cfg || cfg.formId !== formId || cfg.status !== 'READY' || !activity || activity.formId !== formId || activity.active !== true || activity.status !== 'READY' ||
        !Number.isInteger(cfg.configVersion) || cfg.configVersion < 1 || activity.configVersion !== cfg.configVersion) throw new Error('A cópia de homologação exige configuração e vínculo atuais READY.');
    const uniqueUids = [...new Set(Array.isArray(cfg.eligibleUids) ? cfg.eligibleUids : [])];
    if (uniqueUids.length !== 3 || cfg.eligibleUids.length !== 3 || uniqueUids.some(function (uid) { return !formsEvaluationId_(uid); })) throw new Error('Homologação exige exatamente três UIDs distintos no público: participante, gestor e administrador independente.');
    const profiles = formsEvaluationAll_('users');
    const selected = uniqueUids.map(function (uid) {
      const current = profiles.find(function (profile) { return profile.id === uid; });
      if (!current || current.uid !== uid || !formsEvaluationActive_(current) || formsEvaluationResolveIdentity_({settings: {emailCollectionType: 'VERIFIED'}}, {respondentEmail: current.email}, profiles).uid !== uid) throw new Error('Os três perfis devem estar ativos, aprovados e possuir identidade Google única.');
      const minimal = {id: uid, uid: uid, email: current.email, active: true, access: true, role: current.role || '', permissions: current.permissions || {}};
      if (typeof current.displayName === 'string') minimal.displayName = current.displayName;
      if (typeof current.sigla === 'string') minimal.sigla = current.sigla;
      return minimal;
    });
    const operator = formsEvaluationResolveIdentity_({settings: {emailCollectionType: 'VERIFIED'}}, {respondentEmail: operatorEmail}, profiles);
    const operatorProfile = operator.uid && profiles.find(function (profile) { return profile.id === operator.uid; });
    if (!formsEvaluationAdmin_(operatorProfile)) throw new Error('A captura exige operador autorizado com perfil administrativo vigente.');
    const area = evaluationGet_('managementAreas', cfg.managerAreaId);
    const assignment = evaluationGet_('evaluationAssignments', cfg.managerAreaId);
    if (!area || area.active !== true || !assignment || assignment.uid !== cfg.managerUid || assignment.id !== cfg.assignmentId || cfg.assignmentId !== area.id ||
        assignment.version !== cfg.assignmentVersion || !uniqueUids.includes(assignment.uid)) throw new Error('Confira a área ativa e a designação atual do gestor da cópia.');
    const historyId = 'assignment-' + formsEvaluationHash_(area.id + '\u0000' + assignment.version);
    const history = evaluationGet_('evaluationAssignmentHistory', historyId);
    if (!history || history.uid !== assignment.uid || history.version !== assignment.version) throw new Error('Histórico da designação atual está incompleto; captura bloqueada.');
    const reviewers = selected.filter(function (profile) { return profile.uid !== assignment.uid && formsEvaluationAdmin_(profile); });
    const participants = selected.filter(function (profile) { return profile.uid !== assignment.uid && !formsEvaluationAdmin_(profile); });
    if (reviewers.length !== 1 || participants.length !== 1) throw new Error('Use participante, gestor designado e administrador revisor em três contas independentes.');
    const metadata = formsEvaluationMetadata_(formId);
    if (!metadata.info || !String(metadata.info.title || '').startsWith('[HOMOLOGAÇÃO SAHMT]')) throw new Error('A origem deve ser uma cópia identificada por [HOMOLOGAÇÃO SAHMT].');
    const form = FormApp.openById(formId);
    if (!form.hasLimitOneResponsePerUser() || form.canEditResponse()) throw new Error('Homologação exige uma resposta por conta e edição após envio desativada.');
    const checked = formsEvaluationCheckedMapping_(metadata, cfg);
    if (checked.questionFingerprint !== formsEvaluationSavedQuestionFingerprint_(cfg) || checked.maxTestScore !== cfg.maxTestScore) throw new Error('Itens, gabarito ou pesos não correspondem à configuração READY.');
    const validFrom = new Date(cfg.validFrom), validUntil = new Date(cfg.validUntil), firstEligibleAt = new Date(cfg.firstEligibleAt);
    if (!cfg.validFrom || !cfg.validUntil || !cfg.firstEligibleAt || ![validFrom, validUntil, firstEligibleAt].every(function (date) { return Number.isFinite(date.getTime()); }) || validUntil < validFrom || firstEligibleAt > validUntil) throw new Error('Vigência e início de elegibilidade da cópia são inválidos.');
    const eligibleFrom = new Date(Math.max(validFrom.getTime(), firstEligibleAt.getTime()));
    const responseLimit = 25;
    const page = formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(formId) + '/responses?pageSize=' + responseLimit + '&filter=' + encodeURIComponent('timestamp >= ' + eligibleFrom.toISOString()));
    if (!Array.isArray(page.responses || []) || (page.responses || []).length > responseLimit || page.nextPageToken) throw new Error('A cópia excede o limite de 25 respostas; captura incompleta não será salva.');
    const responses = [], states = [], seenResponses = {}, seenUids = {};
    let excludedResponses = 0, pendingGrades = 0;
    (page.responses || []).forEach(function (response) {
      const identity = formsEvaluationResolveIdentity_(metadata, response, profiles);
      const submittedAt = new Date(response.createTime);
      if (identity.status !== 'CONFIRMED' || !uniqueUids.includes(identity.uid) || !Number.isFinite(submittedAt.getTime()) || submittedAt < eligibleFrom || submittedAt > validUntil) { excludedResponses++; return; }
      if (!formsEvaluationId_(response.responseId) || response.formId && response.formId !== formId) throw new Error('Resposta inválida ou pertencente a outra origem.');
      if (seenResponses[response.responseId] || seenUids[identity.uid]) throw new Error('Há mais de uma resposta por conta ou resposta duplicada; confira a cópia antes da captura.');
      seenResponses[response.responseId] = true; seenUids[identity.uid] = true;
      const raw = {responseId: response.responseId, respondentEmail: response.respondentEmail, createTime: response.createTime, answers: response.answers || {}};
      if (response.formId) raw.formId = response.formId;
      if (response.lastSubmittedTime) raw.lastSubmittedTime = response.lastSubmittedTime;
      if (response.totalScore !== undefined) raw.totalScore = response.totalScore;
      const decoded = formsEvaluationParticipation_(metadata, cfg, raw, profiles);
      const testStatus = decoded.test ? decoded.test.status : 'NEEDS_REVIEW';
      if (testStatus === 'PENDING_GRADE') pendingGrades++;
      responses.push(raw);
      states.push({responseId: raw.responseId, uid: identity.uid, status: decoded.status, testStatus: testStatus, sourceFingerprint: formsEvaluationHash_(raw)});
    });
    const config = evaluationClean_(cfg), visible = evaluationClean_(activity), currentAssignment = evaluationClean_(assignment), assignmentHistory = evaluationClean_(history);
    const minimalArea = {id: area.id, active: true, title: String(area.title || ''), managerUids: Array.isArray(area.managerUids) ? area.managerUids : []};
    const configFingerprint = formsEvaluationHash_(config);
    const fetchedAt = new Date();
    const runId = 'homologation-' + formsEvaluationHash_([formId, configFingerprint, responses, fetchedAt.toISOString(), operator.uid, Utilities.getUuid()]);
    const snapshot = {id: runId, schemaVersion: 1, purpose: 'ISOLATED_EVALUATION_HOMOLOGATION', source: 'FORMS_HOMOLOGATION_CAPTURE', productionFinancialWrites: false, formId: formId, operatorUid: operator.uid,
      metadata: metadata, config: config, activity: visible, profiles: selected, roles: {participantUid: participants[0].uid, managerUid: assignment.uid, reviewerUid: reviewers[0].uid},
      area: minimalArea, assignment: currentAssignment, assignmentHistory: [assignmentHistory], responses: responses, responseStates: states,
      evidence: {metadataFingerprint: formsEvaluationHash_(metadata), configFingerprint: configFingerprint, fetchedAt: fetchedAt, eligibleFrom: eligibleFrom, eligibleUntil: validUntil,
        responseLimit: responseLimit, excludedResponses: excludedResponses, pendingGrades: pendingGrades}};
    const snapshotBytes = encodeURIComponent(formsEvaluationStable_(snapshot)).replace(/%[0-9A-F]{2}|[^%]/g, 'x').length;
    if (snapshotBytes > 512000) throw new Error('Snapshot excede o orçamento privado de 512 KB; reduza a cópia de homologação.');
    return evaluationRunTransaction_(function (tx) {
      if (formsEvaluationHash_(evaluationClean_(evaluationGet_('evaluationFormConfigs', formId, tx))) !== configFingerprint ||
          formsEvaluationHash_(evaluationClean_(evaluationGet_('evaluationActivities', formId, tx))) !== formsEvaluationHash_(visible) ||
          formsEvaluationHash_(evaluationClean_(evaluationGet_('evaluationAssignments', cfg.managerAreaId, tx))) !== formsEvaluationHash_(currentAssignment) ||
          formsEvaluationHash_(evaluationClean_(evaluationGet_('evaluationAssignmentHistory', historyId, tx))) !== formsEvaluationHash_(assignmentHistory) ||
          formsEvaluationHash_(evaluationClean_(evaluationGet_('managementAreas', area.id, tx))) !== formsEvaluationHash_(evaluationClean_(area))) throw new Error('Configuração ou designação mudou durante a captura; execute novamente.');
      const liveProfiles = formsEvaluationAll_('users', [], tx);
      selected.concat([evaluationClean_(operatorProfile)]).forEach(function (expected) {
        const live = evaluationGet_('users', expected.uid, tx);
        if (!live || live.uid !== expected.uid || !formsEvaluationActive_(live) || formsEvaluationResolveIdentity_(metadata, {respondentEmail: live.email}, liveProfiles).uid !== expected.uid || String(live.email || '').trim().toLowerCase() !== String(expected.email || '').trim().toLowerCase() ||
            formsEvaluationAdmin_(live) !== formsEvaluationAdmin_(expected) || formsEvaluationHash_(live.permissions || {}) !== formsEvaluationHash_(expected.permissions || {})) throw new Error('Acesso de uma conta mudou durante a captura; execute novamente.');
      });
      return {writes: [evaluationWrite_('evaluationHomologationInputs', runId, snapshot, null, ['capturedAt'])],
        result: {status: 'CAPTURED', runId: runId, responses: responses.length, pendingGrades: pendingGrades, pendingResponses: states.filter(function (state) { return state.status !== 'CONFIRMED'; }).length, excludedResponses: excludedResponses}};
    });
  } finally { lock.releaseLock(); }
}
