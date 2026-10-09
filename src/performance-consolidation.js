// Pure reconciliation of trusted datasets. This module does not read Firebase,
// authorize users, grant points or change the published evaluation UI.
const CATEGORIES = new Set(['PERFORMANCE', 'GOVERNANCE']);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s/]/.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000;
const close = (a, b) => Math.abs(a - b) <= 1e-8;
const ready = value => value?.complete === true && value.fromCache === false && value.pendingWrites === false && value.hasMore === false;
const path = (collection, id) => `${collection}/${id}`;
const key = origin => `${origin.sourceProjectId}/${origin.sourcePath}`;
const fail = message => { throw new TypeError(message); };

function validPath(value) {
  return typeof value === 'string' && /^(evaluationAwards|evaluationLedger)\/[A-Za-z0-9_-]{1,200}$/.test(value);
}

/**
 * An identity is explicit, never inferred from an email address or display name.
 * Each sidecar identifies one copied document; it is not a permission record.
 * A member directory associates the two authenticated UIDs with a stable memberId.
 * complete means the supplied award AND ledger datasets cover the declared scope.
 */
export function consolidatePerformance(input) {
  if (!input || typeof input !== 'object' || !text(input.faProjectId) || !text(input.fbProjectId) || input.faProjectId === input.fbProjectId) fail('Two distinct project IDs are required.');
  const {faProjectId, fbProjectId, memberDirectory, sources, migrationSidecars = [], scope} = input;
  if (!memberDirectory || !Array.isArray(memberDirectory.members) || !Array.isArray(sources) || !Array.isArray(migrationSidecars)) fail('Member directory, sources and sidecars must be explicit arrays.');
  if (!scope || !['member', 'team'].includes(scope.kind) || scope.kind === 'member' && !text(scope.memberId)) fail('An explicit member or team scope is required.');
  const projects = new Set([faProjectId, fbProjectId]);
  const issues = [], issue = (code, details = {}) => issues.push({code, ...details});
  const identities = new Map(), members = new Map();
  for (const member of memberDirectory.members) {
    if (!member || !text(member.memberId) || !text(member.faUid) || !text(member.fbUid) || typeof member.active !== 'boolean' || typeof member.access !== 'boolean') fail('Each member requires stable memberId, both project UIDs and explicit active/access flags.');
    if (members.has(member.memberId)) issue('DUPLICATE_MEMBER', {memberId: member.memberId});
    members.set(member.memberId, member);
    for (const [projectId, uid] of [[faProjectId, member.faUid], [fbProjectId, member.fbUid]]) {
      const identity = `${projectId}/${uid}`;
      if (identities.has(identity)) issue('AMBIGUOUS_MEMBER_UID', {projectId, memberId: member.memberId});
      identities.set(identity, member.memberId);
    }
  }
  if (!ready(memberDirectory)) issue('MEMBER_DIRECTORY_INCOMPLETE');
  if (scope.kind === 'member' && !members.has(scope.memberId)) issue('MEMBER_NOT_MAPPED', {memberId: scope.memberId});
  if (scope.kind === 'member' && members.has(scope.memberId) && !(members.get(scope.memberId).active && members.get(scope.memberId).access)) issue('MEMBER_INACTIVE', {memberId: scope.memberId});

  const sidecars = new Map();
  for (const item of migrationSidecars) {
    if (!item || item.sourceProjectId !== faProjectId || item.destinationProjectId !== fbProjectId || !validPath(item.sourcePath) || !validPath(item.destinationPath) || item.sourcePath.split('/')[0] !== item.destinationPath.split('/')[0]) fail('A migration sidecar must identify an FA document and its FB copy in the same collection.');
    const destination = `${item.destinationProjectId}/${item.destinationPath}`;
    const origin = {sourceProjectId: item.sourceProjectId, sourcePath: item.sourcePath};
    if (sidecars.has(destination)) issue('DUPLICATE_MIGRATION_SIDECAR', {destinationPath: item.destinationPath});
    sidecars.set(destination, origin);
  }
  const canonicalOrigin = (projectId, documentPath) => sidecars.get(`${projectId}/${documentPath}`) || {sourceProjectId: projectId, sourcePath: documentPath};
  const sourceRecords = new Map();
  const sourceStates = [];
  for (const source of sources) {
    if (!source || !projects.has(source.projectId) || !Array.isArray(source.awards) || !Array.isArray(source.ledger)) fail('Each source must identify FA or FB and contain award and ledger arrays.');
    if (sourceRecords.has(source.projectId)) issue('DUPLICATE_SOURCE', {projectId: source.projectId});
    sourceRecords.set(source.projectId, source);
    const coverage = source.coverage;
    const covered = coverage?.kind === 'team' || scope.kind === 'member' && coverage?.kind === 'member' && coverage.memberId === scope.memberId;
    const available = source.status === 'ready' && ready(source) && covered;
    sourceStates.push({projectId: source.projectId, available, status: source.status || 'unknown', coverage: coverage?.kind || 'unknown'});
    if (!available) issue('SOURCE_INCOMPLETE', {projectId: source.projectId});
    if (source.awards.length > 10000 || source.ledger.length > 50000) issue('DATASET_LIMIT_EXCEEDED', {projectId: source.projectId});
  }
  for (const projectId of projects) if (!sourceRecords.has(projectId)) issue('SOURCE_MISSING', {projectId});

  // Compare audit content too. UID fields are compared by stable member association.
  // Document IDs may differ in a copy; all other JSON audit fields are preserved.
  const atPath = (value, segments) => segments.reduce((current, segment) => current?.[segment], value);
  function samePreservedValue(left, right) {
    if (left === right) return true;
    if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
    if (left && typeof left.toMillis === 'function' || right && typeof right.toMillis === 'function') return left?.seconds === right?.seconds && left?.nanoseconds === right?.nanoseconds;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((name, index) => name === rightKeys[index] && samePreservedValue(left[name], right[name]));
  }
  function canonicalValue(value, projectId, field = '', context = {}, segments = []) {
    if ((field === 'uid' || field.endsWith('Uid')) && typeof value === 'string' && value) {
      // A copy can preserve a historical FA author. A new FB correction can
      // preserve the evidence of the original award, but its current actor must
      // still resolve in FB. Match the actual original field before using FA.
      const historical = atPath(context.historicalRecord, segments) === value || segments[0] === 'evidence' && atPath(context.historicalEvidence, segments.slice(1)) === value;
      const memberId = historical ? identities.get(`${faProjectId}/${value}`) : identities.get(`${projectId}/${value}`);
      if (!memberId) issue('AUDIT_UID_NOT_MAPPED', {projectId});
      return memberId ? {memberId} : {unmappedUid: value};
    }
    if (value instanceof Date || value && typeof value.toMillis === 'function') {
      const millis = value instanceof Date ? value.getTime() : null;
      const seconds = value instanceof Date ? Math.floor(millis / 1000) : value.seconds;
      const nanoseconds = value instanceof Date ? (millis - seconds * 1000) * 1000000 : value.nanoseconds;
      if (!Number.isSafeInteger(seconds) || seconds < -62135596800 || seconds > 253402300799 || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999999999) fail('Audit timestamps must preserve valid seconds and nanoseconds.');
      return {timestampSeconds: seconds, timestampNanoseconds: nanoseconds};
    }
    if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, projectId, field.endsWith('Uids') ? 'uid' : '', context, [...segments, index]));
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonicalValue(value[name], projectId, name, context, [...segments, name])]));
    if (typeof value === 'number' && !Number.isFinite(value) || value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') fail('Record audit content must contain finite JSON values or timestamps.');
    return value;
  }
  function signature(record, projectId, omitted, origin, awardOrigin = origin) {
    const original = projectId === fbProjectId && origin?.sourceProjectId === faProjectId ? documents.get(key(origin)) : null;
    const originalAward = projectId === fbProjectId && awardOrigin?.sourceProjectId === faProjectId ? documents.get(key(awardOrigin)) : null;
    const context = {
      historicalRecord: original?.awardVersion === record.awardVersion ? original : null,
      historicalEvidence: record.sourceType === 'ADMIN_CORRECTION' && samePreservedValue(record.evidence, originalAward?.evidence) ? originalAward?.evidence : null
    };
    return JSON.stringify(canonicalValue(Object.fromEntries(Object.entries(record).filter(([field]) => !omitted.includes(field))), projectId, '', context));
  }
  const awards = new Map(), localAwards = new Map(), documents = new Map(), scopeKeys = new Map();
  for (const source of sources) {
    for (const award of source.awards) {
      if (!award || !text(award.id) || !text(award.uid) || !CATEGORIES.has(award.category) || !text(award.creditScopeId) || !text(award.modality) || !['string', 'number'].includes(typeof award.version) || typeof award.version === 'number' && !Number.isFinite(award.version) || !text(String(award.version)) || !number(award.points) || !number(award.originalPoints) || !text(award.lastLedgerId) || !Number.isSafeInteger(award.awardVersion) || award.awardVersion < 1 || award.awardVersion > 50000) {
        issue('INVALID_AWARD', {projectId: source.projectId}); continue;
      }
      const memberId = identities.get(`${source.projectId}/${award.uid}`);
      if (!memberId) { issue('AWARD_MEMBER_NOT_MAPPED', {projectId: source.projectId}); continue; }
      if (source.coverage?.kind === 'member' && source.coverage.memberId !== memberId) issue('SOURCE_SCOPE_MISMATCH', {projectId: source.projectId});
      const documentPath = path('evaluationAwards', award.id), localKey = `${source.projectId}/${documentPath}`;
      if (documents.has(localKey)) issue('DUPLICATE_DOCUMENT', {projectId: source.projectId, documentPath});
      documents.set(localKey, award);
      const origin = canonicalOrigin(source.projectId, documentPath), awardKey = key(origin);
      const record = {record: award, memberId, origin, projectId: source.projectId, documentPath};
      const logicalKey = JSON.stringify([memberId, award.category, award.creditScopeId, String(award.version), award.modality]);
      if (scopeKeys.has(logicalKey) && scopeKeys.get(logicalKey) !== awardKey) issue('AMBIGUOUS_CREDIT_SCOPE', {memberId, category: award.category});
      scopeKeys.set(logicalKey, awardKey);
      if (!awards.has(awardKey)) awards.set(awardKey, []);
      awards.get(awardKey).push(record); localAwards.set(localKey, record);
    }
  }

  const events = new Map(), eventsByAward = new Map();
  for (const source of sources) {
    for (const entry of source.ledger) {
      if (!entry || !text(entry.id) || !text(entry.awardId) || !text(entry.uid) || !CATEGORIES.has(entry.category) || typeof entry.correctsId !== 'string' || entry.correctsId !== '' && !text(entry.correctsId) || !Number.isSafeInteger(entry.awardVersion) || entry.awardVersion < 1 || entry.awardVersion > 50000 || !number(entry.points) || !number(entry.pointsBefore) || !number(entry.correctedPoints) || !number(entry.originalPoints)) {
        issue('INVALID_LEDGER', {projectId: source.projectId}); continue;
      }
      const documentPath = path('evaluationLedger', entry.id), localKey = `${source.projectId}/${documentPath}`;
      if (documents.has(localKey)) issue('DUPLICATE_DOCUMENT', {projectId: source.projectId, documentPath});
      documents.set(localKey, entry);
      const award = localAwards.get(`${source.projectId}/${path('evaluationAwards', entry.awardId)}`);
      if (!award) { issue('LEDGER_AWARD_MISSING', {projectId: source.projectId, documentPath}); continue; }
      const memberId = identities.get(`${source.projectId}/${entry.uid}`);
      if (memberId !== award.memberId || entry.category !== award.record.category || entry.modality !== award.record.modality || entry.creditScopeId !== award.record.creditScopeId || String(entry.version) !== String(award.record.version)) issue('LEDGER_IDENTITY_CONFLICT', {projectId: source.projectId, documentPath});
      const eventKey = `${key(award.origin)}@${entry.awardVersion}`;
      const origin = canonicalOrigin(source.projectId, documentPath);
      if (!events.has(eventKey)) events.set(eventKey, []);
      events.get(eventKey).push({record: entry, award, memberId, origin, projectId: source.projectId, documentPath});
      const awardKey = key(award.origin);
      if (!eventsByAward.has(awardKey)) eventsByAward.set(awardKey, new Map());
      eventsByAward.get(awardKey).set(entry.awardVersion, events.get(eventKey));
    }
  }
  for (const [destination, origin] of sidecars) {
    if (!documents.has(destination)) issue('MIGRATION_DESTINATION_MISSING', {destinationPath: destination.split('/').slice(1).join('/')});
    const original = documents.get(key(origin));
    if (!original) issue('MIGRATION_ORIGINAL_MISSING', {sourcePath: origin.sourcePath});
    if (original && origin.sourcePath.startsWith('evaluationLedger/')) {
      const copy = documents.get(destination);
      const originalAward = localAwards.get(`${faProjectId}/${path('evaluationAwards', original.awardId)}`);
      const copyAward = copy && localAwards.get(`${fbProjectId}/${path('evaluationAwards', copy.awardId)}`);
      if (!originalAward || !copyAward || key(originalAward.origin) !== key(copyAward.origin) || original.awardVersion !== copy.awardVersion) issue('MIGRATION_LEDGER_IDENTITY_CONFLICT', {sourcePath: origin.sourcePath});
    }
  }

  const awardRows = [], ledgerRows = [];
  for (const [awardKey, candidates] of awards) {
    candidates.sort((a, b) => b.record.awardVersion - a.record.awardVersion || a.projectId.localeCompare(b.projectId));
    const latest = candidates[0], record = latest.record;
    const invariant = [record.category, record.creditScopeId, String(record.version), record.modality];
    for (const candidate of candidates) {
      const candidateInvariant = [candidate.record.category, candidate.record.creditScopeId, String(candidate.record.version), candidate.record.modality];
      if (candidate.memberId !== latest.memberId || JSON.stringify(invariant) !== JSON.stringify(candidateInvariant) || !close(candidate.record.originalPoints, record.originalPoints)) issue('AWARD_IDENTITY_CONFLICT', {sourcePath: latest.origin.sourcePath});
      const peers = candidates.filter(item => item.record.awardVersion === candidate.record.awardVersion);
      if (peers.some(item => signature(item.record, item.projectId, ['id', 'lastLedgerId'], item.origin) !== signature(candidate.record, candidate.projectId, ['id', 'lastLedgerId'], candidate.origin))) issue('AWARD_VERSION_CONFLICT', {sourcePath: latest.origin.sourcePath, awardVersion: candidate.record.awardVersion});
    }
    let previous = 0, expectedVersion = 1;
    const versions = [...(eventsByAward.get(awardKey) || new Map())].sort(([a], [b]) => a - b);
    for (const [version, alternatives] of versions) {
      if (version > record.awardVersion) { issue('LEDGER_AHEAD_OF_AWARD', {sourcePath: latest.origin.sourcePath}); continue; }
      if (version !== expectedVersion) issue('LEDGER_VERSION_MISSING', {sourcePath: latest.origin.sourcePath, awardVersion: expectedVersion});
      expectedVersion = version + 1;
      const event = alternatives[0];
      if (alternatives.some(item => signature(item.record, item.projectId, ['id', 'awardId', 'correctsId'], item.origin, item.award.origin) !== signature(event.record, event.projectId, ['id', 'awardId', 'correctsId'], event.origin, event.award.origin))) issue('LEDGER_VERSION_CONFLICT', {sourcePath: latest.origin.sourcePath, awardVersion: version});
      if (alternatives.length > 1 && alternatives.some(item => key(item.origin) !== key(event.origin))) issue('LEDGER_ORIGIN_NOT_PROVEN', {sourcePath: latest.origin.sourcePath, awardVersion: version});
      const entry = event.record;
      if (version === 1 && !close(entry.originalPoints, entry.correctedPoints)) issue('ORIGINAL_POINTS_CONFLICT', {sourcePath: latest.origin.sourcePath});
      for (const alternative of alternatives) {
        const predecessor = version === 1 ? null : (events.get(`${awardKey}@${version - 1}`) || []).find(item => item.projectId === alternative.projectId && item.record.id === alternative.record.correctsId);
        if (version === 1 && alternative.record.correctsId !== '' || version > 1 && !predecessor) issue('LEDGER_PREDECESSOR_CONFLICT', {sourcePath: latest.origin.sourcePath, awardVersion: version});
      }
      if (!close(entry.pointsBefore, previous) || !close(entry.correctedPoints, previous + entry.points) || !close(entry.originalPoints, record.originalPoints)) issue('LEDGER_DELTA_CONFLICT', {sourcePath: latest.origin.sourcePath, awardVersion: version});
      previous = entry.correctedPoints;
      for (const candidate of candidates.filter(item => item.record.awardVersion === version)) {
        if (!close(candidate.record.points, previous)) issue('AWARD_LEDGER_CONFLICT', {sourcePath: latest.origin.sourcePath, awardVersion: version});
        if (!alternatives.some(item => item.projectId === candidate.projectId && item.record.id === candidate.record.lastLedgerId)) issue('AWARD_LEDGER_POINTER_CONFLICT', {sourcePath: latest.origin.sourcePath, awardVersion: version});
      }
      ledgerRows.push({canonicalAward: latest.origin, canonicalOrigin: event.origin, memberId: latest.memberId, category: record.category, modality: record.modality, creditScopeId: record.creditScopeId, version: record.version, awardVersion: version, points: entry.points, pointsBefore: entry.pointsBefore, correctedPoints: entry.correctedPoints,
        origins: alternatives.map(item => ({projectId: item.projectId, documentPath: item.documentPath}))});
    }
    if (expectedVersion <= record.awardVersion) issue('LEDGER_VERSION_MISSING', {sourcePath: latest.origin.sourcePath, awardVersion: expectedVersion});
    if (!close(previous, record.points)) issue('AWARD_TOTAL_CONFLICT', {sourcePath: latest.origin.sourcePath});
    awardRows.push({canonicalOrigin: latest.origin, memberId: latest.memberId, category: record.category, modality: record.modality, creditScopeId: record.creditScopeId, version: record.version, awardVersion: record.awardVersion, points: record.points, originalPoints: record.originalPoints, transferId: record.transferId || '', leg: record.leg || '',
      origins: candidates.map(item => ({projectId: item.projectId, documentPath: item.documentPath, awardVersion: item.record.awardVersion}))});
  }
  if (scope.kind === 'team') {
    const transfers = new Map();
    for (const award of awardRows.filter(item => item.modality === 'CHECKLIST')) {
      if (!text(award.transferId)) { issue('CHECKLIST_TRANSFER_ID_MISSING'); continue; }
      if (!transfers.has(award.transferId)) transfers.set(award.transferId, []);
      transfers.get(award.transferId).push(award);
    }
    for (const [transferId, legs] of transfers) if (!close(legs.reduce((sum, item) => sum + item.points, 0), 0) || legs.some(item => !['SELF', 'DEBIT', 'CREDIT', 'REVERSED'].includes(item.leg)) || legs.some(item => item.leg === 'SELF' && item.points !== 0 || item.leg === 'DEBIT' && item.points > 0 || item.leg === 'CREDIT' && item.points < 0 || item.leg === 'REVERSED' && item.points !== 0)) issue('CHECKLIST_PAIR_CONFLICT', {transferId});
  }
  const eligible = [...members.values()].filter(member => member.active && member.access);
  if (scope.kind === 'team' && !eligible.length) issue('NO_ELIGIBLE_TEAM_MEMBERS');
  const visible = item => scope.kind === 'team' || item.memberId === scope.memberId;
  const rows = awardRows.filter(visible), history = ledgerRows.filter(visible);
  const calculated = Object.fromEntries(eligible.filter(member => scope.kind === 'team' || member.memberId === scope.memberId).map(member => [member.memberId, {performance: 0, governance: 0}]));
  for (const award of rows) if (calculated[award.memberId]) calculated[award.memberId][award.category === 'PERFORMANCE' ? 'performance' : 'governance'] += award.points;
  for (const [memberId, balance] of Object.entries(calculated)) for (const [category, total] of Object.entries(balance)) if (!number(total)) issue('BALANCE_LIMIT_EXCEEDED', {memberId, category: category === 'performance' ? 'PERFORMANCE' : 'GOVERNANCE'});
  const available = issues.length === 0, totals = available ? calculated : null;
  let teamReference = null;
  if (available && scope.kind === 'team') {
    const values = Object.values(totals).map(item => item.performance), maximum = Math.max(...values), allZero = values.every(value => value === 0);
    teamReference = {complete: true, eligibleCount: eligible.length, maxPerformance: maximum, allZero};
    for (const total of Object.values(totals)) total.percentage = maximum > 0 ? total.performance / maximum * 100 : allZero ? 0 : null;
  }
  return {status: available ? 'CONFIRMED' : 'UNAVAILABLE', complete: available, reviewRequired: issues.some(item => !['SOURCE_INCOMPLETE', 'SOURCE_MISSING', 'MEMBER_DIRECTORY_INCOMPLETE'].includes(item.code)), issues, sources: sourceStates,
    total: available && scope.kind === 'member' ? totals[scope.memberId] : null, totals, teamReference, awards: rows, ledger: history};
}
