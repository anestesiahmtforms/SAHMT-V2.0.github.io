import {snapshotDigest, documentDigest, validateSplitSnapshot} from './management-split-plan.js';
import {validateManagementCaptureQuarterPlan} from './management-capture-quarter-plan.js';
import {validateManagementCaptureQuarterHead} from './management-capture-quarter-head.js';

const FA = 'sahmt-17a16';
const SHA = /^[a-f0-9]{64}$/;
export const MANAGEMENT_QUARTER_REVIEW_BASELINE = 'capture-FA-20261009010412736-reviewed.dpapi.json';
export const MANAGEMENT_QUARTER_REVIEW_RECEIPT = 'management-split-receipt-v2.json';
const demand = (ok, code) => {if (!ok) throw Error(code);};
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v, minimum = 0) => Number.isSafeInteger(v) && v >= minimum && !Object.is(v, -0);
const same = (a, b) => snapshotDigest(a) === snapshotDigest(b);
const setEqual = (a, b) => Array.isArray(a) && Array.isArray(b)
  && new Set(a).size === a.length && new Set(b).size === b.length
  && a.length === b.length && a.every(v => b.includes(v));
const captureName = v => typeof v === 'string' && /^capture-FA-[0-9]{1,32}\.dpapi\.json$/.test(v);
const checkpointName = v => typeof v === 'string' && /^capture-FA-[0-9]{1,32}-latest\.dpapi\.json$/.test(v);
const part = v => typeof v === 'string' && v.length > 0 && !['.', '..', '*'].includes(v) && !/[\/\\\x00-\x1f]/.test(v);
const pathIn = (path, roots, parity) => typeof path === 'string' && path.split('/').length % 2 === parity
  && path.split('/').every(part) && roots.includes(path.split('/')[0]);

function copyJson(value) {
  let nodes = 0, characters = 0;
  const seen = new Set();
  const visit = (v, depth) => {
    demand(++nodes <= 2000000 && depth <= 100, 'QUARTER_REVIEW_INPUT_LIMIT');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') {characters += v.length; demand(characters <= 160 * 1024 * 1024, 'QUARTER_REVIEW_INPUT_LIMIT'); return v;}
    if (typeof v === 'number') {demand(Number.isFinite(v), 'QUARTER_REVIEW_INPUT_INVALID'); return v;}
    demand((Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype || plain(v)) && !seen.has(v), 'QUARTER_REVIEW_INPUT_INVALID');
    seen.add(v);
    const keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) demand(keys.length === v.length + 1 && keys.at(-1) === 'length', 'QUARTER_REVIEW_INPUT_INVALID');
    const result = Array.isArray(v) ? [] : Object.create(null);
    for (const k of keys) {
      if (Array.isArray(v) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      demand(typeof k === 'string' && d.enumerable && Object.hasOwn(d, 'value'), 'QUARTER_REVIEW_INPUT_INVALID');
      characters += k.length; demand(characters <= 160 * 1024 * 1024, 'QUARTER_REVIEW_INPUT_LIMIT');
      Object.defineProperty(result, k, {value:visit(d.value, depth + 1), enumerable:true, writable:true, configurable:true});
    }
    seen.delete(v); return result;
  };
  return visit(value, 0);
}
function time(value) {
  const m = typeof value === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  demand(m && Number(value.slice(0, 4)) > 0, 'QUARTER_REVIEW_TIME_INVALID');
  const ms = Date.parse(m[1] + 'Z');
  demand(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === m[1], 'QUARTER_REVIEW_TIME_INVALID');
  return BigInt(ms) * 1000000n + BigInt((m[2] || '').padEnd(9, '0'));
}

function validateCompleteCore(core, snapshot, receipt, head, plan) {
  demand(plain(core) && core.schemaVersion === 1 && core.mode === 'READ_ONLY_FIRESTORE_CAPTURE'
    && core.projectId === FA && core.databaseId === '(default)' && core.status === 'COMPLETE'
    && core.errorCode === undefined && core.readTime === snapshot.readTime
    && same(core.documents, snapshot.documents) && same(core.rootCollections, snapshot.coverage.rootCollections)
    && core.scopeSha256 === snapshotDigest({projectId:FA, databaseId:'(default)', rootCollections:core.rootCollections})
    && core.scopeSha256 === snapshot.coverage.scopeSha256 && core.snapshotSha256 === snapshotDigest(snapshot)
    && Array.isArray(core.queue) && core.queue.length === 0 && core.active === null,
  'QUARTER_REVIEW_CORE_INCOMPLETE_OR_CHANGED');
  demand(time(core.readTime) <= time(core.startedAt) && time(core.startedAt) <= time(core.finishedAt)
    && time(core.finishedAt) <= time(core.lastObservedAt)
    && time(core.finishedAt) - time(core.readTime) < 3600000000000n,
  'QUARTER_REVIEW_CAPTURE_TIMELINE_INVALID');
  demand(head.readTime === core.readTime && head.checkpointFinishedAt === core.finishedAt
    && head.checkpointObservedAt === core.lastObservedAt
    && head.checkpointSha256 === snapshotDigest(core) && head.captureConfigSha256 === core.captureConfigSha256,
  'QUARTER_REVIEW_CHECKPOINT_PIN_MISMATCH');
  const {lastObservedAt, ...content} = core;
  demand(head.checkpointContentSha256 === snapshotDigest(content), 'QUARTER_REVIEW_CHECKPOINT_PIN_MISMATCH');
  const paths = new Set(snapshot.documents.map(d => d.path));
  demand(Array.isArray(core.missingDocumentPaths) && new Set(core.missingDocumentPaths).size === core.missingDocumentPaths.length
    && core.missingDocumentPaths.every(p => pathIn(p, core.rootCollections, 0) && !paths.has(p)),
  'QUARTER_REVIEW_COVERAGE_INVALID');
  for (const p of core.missingDocumentPaths) paths.add(p);
  demand(setEqual(core.knownCollections, core.completedCollections)
    && core.rootCollections.every(r => core.knownCollections.includes(r))
    && core.knownCollections.every(p => pathIn(p, core.rootCollections, 1)
      && (p.split('/').length === 1 || paths.has(p.split('/').slice(0, -1).join('/'))))
    && [...paths].every(p => core.knownCollections.includes(p.split('/').slice(0, -1).join('/')))
    && setEqual(core.completedDiscoveryParents, [...paths]), 'QUARTER_REVIEW_COVERAGE_INVALID');

  demand(exact(receipt.limits, ['maxPages','maxDepth','maxBytes','maxDocuments','maxDurationMs','requestTimeoutMs'])
    && Object.values(receipt.limits).every(v => integer(v, 1)) && receipt.limits.maxDurationMs === plan.maxDurationMs
    && core.documents.length <= receipt.limits.maxDocuments
    && exact(receipt.requestParameters, ['documentPageSize','collectionPageSize','showMissing','mask','orderBy'])
    && receipt.requestParameters.documentPageSize === plan.documentPageSize
    && integer(receipt.requestParameters.collectionPageSize, 1) && receipt.requestParameters.collectionPageSize <= 1000
    && receipt.requestParameters.showMissing === true && receipt.requestParameters.mask === null
    && receipt.requestParameters.orderBy === null, 'QUARTER_REVIEW_CAPTURE_CONFIGURATION_INVALID');
  const expectedConfig = {schemaVersion:1, projectId:FA, databaseId:'(default)', rootCollections:core.rootCollections,
    readTime:core.readTime, pageSize:receipt.requestParameters.documentPageSize,
    collectionPageSize:receipt.requestParameters.collectionPageSize, limits:receipt.limits,
    maxBatchDocuments:plan.maxBatchDocuments, maxBatches:plan.maxBatches};
  demand(core.captureConfigSha256 === snapshotDigest(expectedConfig), 'QUARTER_REVIEW_CAPTURE_CONFIGURATION_INVALID');

  demand(Array.isArray(core.pages) && core.pages.length > 0 && core.pages.length <= receipt.limits.maxPages,
    'QUARTER_REVIEW_PAGE_PROOF_INVALID');
  demand(integer(core.totalReservedReads) && core.totalReservedReads <= plan.maxReservedReadsPerBatch * head.batchNumber,
    'QUARTER_REVIEW_READ_RESERVATION_LIMIT');
  let reserved = 0, bytes = 0, documents = 0, missing = 0, batchIndex = 0;
  const batchReservations = Array(head.batchNumber).fill(0);
  const chains = new Map();
  for (const [index, page] of core.pages.entries()) {
    const keys = ['attempt','operation','parentPath', ...(page.operation === 'listDocuments' ? ['collectionId'] : []),
      'readTime','requestSha256','pageTokenSha256','maximumReads','status','responseSha256','responseBytes',
      'returnedCount','nextPageTokenSha256', ...(page.operation === 'listDocuments' ? ['existingCount','missingCount'] : [])];
    demand(exact(page, keys) && ['listDocuments','listCollectionIds'].includes(page.operation)
      && page.attempt === index + 1 && page.status === 'COMPLETE' && page.readTime === core.readTime
      && SHA.test(page.requestSha256 || '') && SHA.test(page.responseSha256 || '')
      && integer(page.responseBytes, 1) && integer(page.maximumReads, 1) && integer(page.returnedCount)
      && [page.pageTokenSha256, page.nextPageTokenSha256].every(v => v === null || SHA.test(v || '')),
    'QUARTER_REVIEW_PAGE_PROOF_INVALID');
    if (batchIndex + 1 < head.batchNumber && documents + missing === head.runHistory[batchIndex + 1].documentEntriesAtStart) batchIndex++;
    batchReservations[batchIndex] += page.maximumReads;
    demand(batchReservations[batchIndex] <= plan.maxReservedReadsPerBatch, 'QUARTER_REVIEW_READ_RESERVATION_LIMIT');
    const collection = page.parentPath ? page.parentPath + '/' + page.collectionId : page.collectionId;
    if (page.operation === 'listDocuments') {
      demand(core.knownCollections.includes(collection) && part(page.collectionId)
        && (page.parentPath === '' || paths.has(page.parentPath))
        && page.maximumReads <= plan.documentPageSize && page.returnedCount <= page.maximumReads
        && integer(page.existingCount) && integer(page.missingCount)
        && page.existingCount + page.missingCount === page.returnedCount, 'QUARTER_REVIEW_PAGE_PROOF_INVALID');
      documents += page.existingCount; missing += page.missingCount;
    } else demand(paths.has(page.parentPath) && page.maximumReads === 1
      && page.returnedCount <= receipt.requestParameters.collectionPageSize, 'QUARTER_REVIEW_PAGE_PROOF_INVALID');
    demand(batchIndex + 1 === head.batchNumber || documents + missing <= head.runHistory[batchIndex + 1].documentEntriesAtStart,
      'QUARTER_REVIEW_BATCH_PAGE_BOUNDARY_INVALID');
    const key = page.operation + ':' + page.parentPath + ':' + (page.collectionId || '');
    const previous = chains.get(key);
    demand(previous ? previous.last.nextPageTokenSha256 !== null && previous.last.nextPageTokenSha256 === page.pageTokenSha256
      : page.pageTokenSha256 === null, 'QUARTER_REVIEW_PAGE_CHAIN_INVALID');
    const tokens = previous?.tokens || [];
    if (page.nextPageTokenSha256 !== null) {
      demand(page.nextPageTokenSha256 !== page.pageTokenSha256 && !tokens.includes(page.nextPageTokenSha256),
        'QUARTER_REVIEW_PAGE_CHAIN_INVALID'); tokens.push(page.nextPageTokenSha256);
    }
    chains.set(key, {last:page, tokens}); reserved += page.maximumReads; bytes += page.responseBytes;
  }
  demand(batchIndex === head.batchNumber - 1 && reserved === core.totalReservedReads && bytes === core.totalResponseBytes && bytes <= receipt.limits.maxBytes
    && documents === snapshot.documents.length && missing === core.missingDocumentPaths.length,
  'QUARTER_REVIEW_PAGE_COUNTER_INVALID');
  demand([...chains.values()].every(v => v.last.nextPageTokenSha256 === null)
    && core.completedCollections.every(p => [...chains.values()].some(v => v.last.operation === 'listDocuments'
      && (v.last.parentPath ? v.last.parentPath + '/' + v.last.collectionId : v.last.collectionId) === p))
    && core.completedDiscoveryParents.every(p => chains.has('listCollectionIds:' + p + ':')),
  'QUARTER_REVIEW_PAGE_CHAIN_INVALID');

  const batch = core.batch;
  demand(exact(batch, ['number','maxDocuments','maxBatches','documentEntriesAtStart','startedAt','reviewId'])
    && integer(batch.number, 1) && batch.number <= plan.maxBatches && batch.number === head.batchNumber
    && batch.maxDocuments === plan.maxBatchDocuments && batch.maxBatches === plan.maxBatches
    && integer(batch.documentEntriesAtStart)
    && batch.documentEntriesAtStart === head.runHistory.at(-1).documentEntriesAtStart
    && batch.reviewId === head.runHistory.at(-1).reviewId
    && Array.isArray(core.batchHistory) && core.batchHistory.length === batch.number,
  'QUARTER_REVIEW_BATCH_HISTORY_INVALID');
  let captured = 0, previousFinish = time(core.startedAt);
  for (const [index, row] of core.batchHistory.entries()) {
    const last = index === batch.number - 1;
    demand(exact(row, ['number','startedAt','finishedAt','documentEntries','reviewId','status'])
      && row.number === index + 1 && row.status === (last ? 'COMPLETE' : 'PARTIAL_REVIEW')
      && integer(row.documentEntries) && row.documentEntries <= plan.maxBatchDocuments
      && (last || row.documentEntries === plan.maxBatchDocuments)
      && row.reviewId === head.runHistory[index].reviewId
      && head.runHistory[index].documentEntriesAtStart === captured
      && time(row.startedAt) >= previousFinish && time(row.finishedAt) >= time(row.startedAt)
      && time(row.finishedAt) - time(row.startedAt) <= BigInt(plan.maxDurationMs) * 1000000n,
    'QUARTER_REVIEW_BATCH_HISTORY_INVALID');
    captured += row.documentEntries; previousFinish = time(row.finishedAt);
  }
  demand(captured === paths.size && core.batchHistory.at(-1).startedAt === batch.startedAt
    && core.batchHistory.at(-1).finishedAt === core.finishedAt, 'QUARTER_REVIEW_BATCH_HISTORY_INVALID');
  const expectedCounts = {documents:snapshot.documents.length, missingParents:core.missingDocumentPaths.length,
    collectionsCompleted:core.completedCollections.length, discoveryParentsCompleted:core.completedDiscoveryParents.length,
    attempts:core.pages.length, totalReservedReads:core.totalReservedReads, totalResponseBytes:core.totalResponseBytes};
  const expectedHeadCounts = {documents:expectedCounts.documents, missingParents:expectedCounts.missingParents,
    attempts:expectedCounts.attempts, reservedReads:expectedCounts.totalReservedReads, responseBytes:expectedCounts.totalResponseBytes};
  demand(same(receipt.counts, expectedCounts) && same(head.counters, expectedHeadCounts)
    && same(receipt.pages, core.pages) && same(receipt.completedCollections, core.completedCollections)
    && same(receipt.completedDiscoveryParents, core.completedDiscoveryParents)
    && same(receipt.missingDocumentPaths, core.missingDocumentPaths)
    && same(receipt.batch, {number:batch.number, maxDocuments:plan.maxBatchDocuments, maxBatches:plan.maxBatches,
      documentEntriesAtStart:batch.documentEntriesAtStart, documentEntriesCaptured:paths.size - batch.documentEntriesAtStart,
      planExhausted:false, captureConfigSha256:core.captureConfigSha256}),
  'QUARTER_REVIEW_RECEIPT_CORE_MISMATCH');
  return batchReservations;
}

/** Historical local integrity review only. No clock, credentials, I/O, policy
 * mutation, manifest reanchoring, access classification or migration authority. */
export function reviewManagementQuarterSnapshot(input) {
  const value = copyJson(input);
  demand(exact(value, ['captureName','captureCiphertextSha256','packet','publicReceipt','head',
    'checkpointPacket','baselinePacket','baselineReceipt','scope']), 'QUARTER_REVIEW_INPUT_SCHEMA_INVALID');
  const {captureName:name, captureCiphertextSha256, packet, publicReceipt, head:rawHead,
    checkpointPacket, baselinePacket, baselineReceipt, scope} = value;
  demand(captureName(name) && SHA.test(captureCiphertextSha256 || ''), 'QUARTER_REVIEW_INPUT_NAME_OR_PIN_INVALID');
  demand(exact(packet, ['schemaVersion','kind','projectId','status','readBudgetObservation','quarterPlan','checkpointFile','snapshot','receipt'])
    && packet.schemaVersion === 1 && packet.kind === 'FIRESTORE_SELECTED_SCOPE_CAPTURE'
    && packet.projectId === FA && packet.status === 'COMPLETE' && checkpointName(packet.checkpointFile),
  'QUARTER_REVIEW_COMPLETE_PACKET_REQUIRED');
  validateSplitSnapshot(baselinePacket?.snapshot); validateSplitSnapshot(packet.snapshot);
  const snapshot = packet.snapshot, baseline = baselinePacket.snapshot;
  demand(snapshot.projectId === FA && baseline.projectId === FA && snapshot.databaseId === '(default)'
    && baseline.databaseId === '(default)' && time(baseline.readTime) <= time(snapshot.readTime),
  'QUARTER_REVIEW_SOURCE_SCOPE_OR_ORDER_INVALID');
  const plan = validateManagementCaptureQuarterPlan({plan:packet.quarterPlan, sourceSnapshot:baseline, scope});
  demand(baselineReceipt?.sourceSnapshotSha256 === snapshotDigest(baseline)
    && baselineReceipt.sourceSnapshotSha256 === plan.baselineSnapshotSha256,
  'QUARTER_REVIEW_BASELINE_PIN_MISMATCH');
  demand(setEqual(snapshot.coverage.rootCollections, scope.rootCollections)
    && snapshot.coverage.scope === 'SELECTED_ROOT_COLLECTION_TREES', 'QUARTER_REVIEW_SOURCE_SCOPE_OR_ORDER_INVALID');
  const head = validateManagementCaptureQuarterHead({head:rawHead, expectedHeadSha256:publicReceipt?.quarterHeadSha256, plan});
  demand(head.status === 'COMPLETE' && head.activeCheckpointFile === packet.checkpointFile,
    'QUARTER_REVIEW_HEAD_NOT_COMPLETE_OR_CURRENT');
  demand(exact(checkpointPacket, ['schemaVersion','kind','projectId','quarterPlan','coreState'])
    && checkpointPacket.schemaVersion === 1 && checkpointPacket.kind === 'FIRESTORE_QUARTER_CHECKPOINT'
    && checkpointPacket.projectId === FA && same(checkpointPacket.quarterPlan, plan),
  'QUARTER_REVIEW_CHECKPOINT_INVALID');
  const receipt = packet.receipt, {receiptSha256, ...receiptBody} = receipt || {};
  demand(plain(receipt) && receipt.schemaVersion === 1 && receipt.mode === 'READ_ONLY_FIRESTORE_CAPTURE'
    && receipt.projectId === FA && receipt.databaseId === '(default)' && receipt.complete === true
    && receipt.consistent === true && receipt.errorCode === null && SHA.test(receiptSha256 || '')
    && receiptSha256 === snapshotDigest(receiptBody) && receipt.snapshotSha256 === snapshotDigest(snapshot)
    && receipt.readTime === snapshot.readTime && receipt.scopeSha256 === snapshot.coverage.scopeSha256
    && same(receipt.rootCollections, snapshot.coverage.rootCollections),
  'QUARTER_REVIEW_COMPLETE_RECEIPT_REQUIRED');
  const captureReservedReadsByBatch = validateCompleteCore(checkpointPacket.coreState, snapshot, receipt, head, plan);
  demand(receipt.startedAt === checkpointPacket.coreState.startedAt && receipt.finishedAt === checkpointPacket.coreState.finishedAt,
    'QUARTER_REVIEW_RECEIPT_CORE_MISMATCH');
  demand(plain(publicReceipt) && publicReceipt.schemaVersion === 1 && publicReceipt.projectId === FA
    && publicReceipt.status === 'COMPLETE' && publicReceipt.errorCode === null && publicReceipt.file === name
    && publicReceipt.ciphertextSha256 === captureCiphertextSha256
    && publicReceipt.scopeRootCount === scope.rootCollections.length
    && publicReceipt.manualQuarterCapture === true && publicReceipt.automaticNextBatch === false
    && publicReceipt.requiresHumanReview === true && publicReceipt.partialSnapshotEligibleForMigration === false
    && publicReceipt.maxBatchDocuments === plan.maxBatchDocuments && publicReceipt.maxBatches === plan.maxBatches
    && publicReceipt.maxReservedReadsPerBatch === plan.maxReservedReadsPerBatch
    && publicReceipt.capturedCumulative === snapshot.documents.length
    && publicReceipt.checkpointFile === packet.checkpointFile && publicReceipt.quarterPlanSha256 === plan.planSha256
    && publicReceipt.quarterHeadSha256 === head.headSha256 && publicReceipt.quarterHeadRevision === head.revision
    && publicReceipt.receiptSha256 === receipt.receiptSha256 && publicReceipt.snapshotSha256 === receipt.snapshotSha256
    && same(publicReceipt.counts, receipt.counts) && publicReceipt.decryptAndHashVerified === true
    && publicReceipt.lockRetainedRequiresReview === false && publicReceipt.firestoreWritesIssued === 0,
  'QUARTER_REVIEW_PUBLIC_RECEIPT_PIN_MISMATCH');

  const previous = new Map(baseline.documents.map(d => [d.path, d])), current = new Map(snapshot.documents.map(d => [d.path, d]));
  const added = [], removed = [], changed = [];
  let unchanged = 0, changedCreateTimes = 0, advancedUpdateTimes = 0, regressedUpdateTimes = 0, unchangedUpdateTimes = 0;
  for (const [path, doc] of current) {
    const old = previous.get(path), sourceSha256 = documentDigest(doc);
    if (!old) {added.push({path, sourceSha256, createTime:doc.createTime, updateTime:doc.updateTime}); continue;}
    const baselineDocumentSha256 = documentDigest(old);
    if (baselineDocumentSha256 === sourceSha256) {unchanged++; continue;}
    const createTimePreserved = old.createTime === doc.createTime;
    const direction = time(doc.updateTime) > time(old.updateTime) ? 'ADVANCED'
      : time(doc.updateTime) < time(old.updateTime) ? 'REGRESSED' : 'UNCHANGED';
    if (!createTimePreserved) changedCreateTimes++;
    if (direction === 'ADVANCED') advancedUpdateTimes++; else if (direction === 'REGRESSED') regressedUpdateTimes++; else unchangedUpdateTimes++;
    changed.push({path, baselineDocumentSha256, sourceSha256, previousCreateTime:old.createTime,
      createTime:doc.createTime, previousUpdateTime:old.updateTime, updateTime:doc.updateTime,
      createTimePreserved, updateTimeDirection:direction});
  }
  for (const [path, doc] of previous) if (!current.has(path))
    removed.push({path, baselineDocumentSha256:documentDigest(doc), createTime:doc.createTime, updateTime:doc.updateTime});
  for (const rows of [added, removed, changed]) rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const counts = {baselineDocuments:baseline.documents.length, capturedDocuments:snapshot.documents.length,
    added:added.length, removed:removed.length, changed:changed.length, unchanged,
    changedCreateTimes, advancedUpdateTimes, regressedUpdateTimes, unchangedUpdateTimes};
  const pins = {baselineSnapshotSha256:snapshotDigest(baseline), sourceSnapshotSha256:snapshotDigest(snapshot),
    capturePacketSha256:snapshotDigest(packet), captureCiphertextSha256, publicReceiptSha256:snapshotDigest(publicReceipt),
    receiptSha256:receipt.receiptSha256, quarterPlanSha256:plan.planSha256, scopeSha256:plan.scopeSha256,
    headSha256:head.headSha256, checkpointSha256:head.checkpointSha256};
  const flags = {productionAuthorized:false, migrationReady:false, operationalFreshnessEvaluated:false,
    manifestReanchored:false, aclClassificationInferred:false, identityBindingApproved:false,
    sourcePauseChanged:false, readBudgetChanged:false, credentialLookupIssued:0, firestoreDocumentReadsIssued:0,
    firestoreWritesIssued:0, authChangesIssued:0, grantsIssued:0, automaticNextBatch:false};
  const summary = {schemaVersion:1, mode:'LOCAL_COMPLETE_QUARTER_REVIEW', projectId:FA, databaseId:'(default)',
    status:'REVIEW_ONLY', sourceReadTime:snapshot.readTime, baselineReadTime:baseline.readTime,
    captureStartedAt:receipt.startedAt, captureFinishedAt:receipt.finishedAt, counts, pins,
    captureReservedReads:checkpointPacket.coreState.totalReservedReads, captureReservedReadsByBatch,
    deltaNeedsClassificationReview:added.length + removed.length + changed.length > 0, ...flags};
  const protectedReview = {schemaVersion:1, kind:'LOCAL_MANAGEMENT_QUARTER_SNAPSHOT_REVIEW', ...flags,
    sourceSnapshot:snapshot, summary, delta:{added, removed, changed, classification:'UNREVIEWED'},
    files:{capture:name, checkpoint:packet.checkpointFile, baseline:MANAGEMENT_QUARTER_REVIEW_BASELINE,
      baselineReceipt:MANAGEMENT_QUARTER_REVIEW_RECEIPT, head:'quarter-head-FA.json', scope:'backup-scope-FA.json'}};
  return {summary, protectedReview};
}
