import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authImportPlanDigest, authSnapshotDigest, authSourceRecordDigest, authRawSnapshotDigest, prepareAuthImportPlan} from '../scripts/lib/management-auth-import-plan.js';

const account = (uid = 'member-a', changes = {}) => ({
  uid,
  email: `${uid}@example.invalid`,
  emailVerified: true,
  displayName: 'Pessoa fictícia',
  photoURL: 'https://example.invalid/photo.png',
  disabled: false,
  providerData: [{providerId: 'google.com', uid: `google-${uid}`, email: `${uid}@example.invalid`, displayName: 'Pessoa fictícia', photoURL: 'https://example.invalid/photo.png'}],
  ...changes
});
const snapshot = (projectId, users) => ({schemaVersion: 1, projectId, readTime: '2026-10-08T12:00:00.000Z', coverage: {complete: true}, users});
const source = users => snapshot('sahmt-17a16', users);
const destination = users => snapshot('sahmt-gestao-test', users);
const mappings = users => users.map(user => ({memberId: `stable-${user.uid}`, faUid: user.uid, fbUid: user.uid}));
const prepare = (users = [account()], targetUsers = [], links = mappings(users), options) => prepareAuthImportPlan(source(users), destination(targetUsers), links, options);
const hasConflict = (plan, code) => plan.conflicts.some(conflict => conflict.code === code);

test('prepara criação somente para UID ausente e mantém prévia sem autorização de produção', () => {
  const plan = prepare();
  assert.equal(plan.ready, true);
  assert.equal(plan.productionAuthorized, false);
  assert.equal(plan.writeEnabled, false);
  assert.equal(plan.previewOnly, true);
  assert.deepEqual(plan.readiness, {scope: 'STRUCTURAL_PREVIEW_ONLY', structuralReady: true, operationalFreshnessEvaluated: false});
  assert.equal(plan.entries[0].action, 'CREATE');
  assert.deepEqual(plan.importRecords[0], account());
  assert.equal(plan.counts.create, 1);
  assert.match(plan.fingerprints.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(plan.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.resultSha256, authImportPlanDigest(plan));
});

test('reexecução com usuário equivalente ignora registro existente sem objeto de importação', () => {
  const first = prepare();
  const again = prepare([account()], first.importRecords);
  assert.equal(again.ready, true);
  assert.equal(again.entries[0].action, 'SKIP');
  assert.equal(again.entries[0].reason, 'EXISTING_EQUIVALENT_NO_OVERWRITE');
  assert.equal(Object.hasOwn(again.entries[0], 'importRecord'), false);
  assert.deepEqual(again.importRecords, []);
});

test('UID existente com identidade Google diferente exige revisão e não substitui destino', () => {
  const original = account('member-a', {providerData: [{providerId: 'google.com', uid: 'google-other', email: 'member-a@example.invalid'}]});
  const before = structuredClone(original);
  const plan = prepare([account()], [original]);
  assert.equal(plan.entries[0].action, 'CONFLICT');
  assert.equal(hasConflict(plan, 'DESTINATION_USER_DIFFERS_REQUIRES_REVIEW'), true);
  assert.deepEqual(plan.importRecords, []);
  assert.deepEqual(original, before);
});

test('identidade Google presente sob outro UID bloqueia nova conta', () => {
  const target = account('member-b', {providerData: [{providerId: 'google.com', uid: 'google-member-a', email: 'member-b@example.invalid'}]});
  const plan = prepare([account()], [target]);
  assert.equal(hasConflict(plan, 'DESTINATION_GOOGLE_UID_COLLISION'), true);
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.importRecords, []);
});

test('colisão de e-mail no destino é detectada sem remapear membro por e-mail', () => {
  const plan = prepare([account()], [account('member-b', {email: 'MEMBER-A@example.invalid'})]);
  assert.equal(hasConflict(plan, 'DESTINATION_EMAIL_COLLISION'), true);
  assert.equal(plan.entries[0].fbUid, 'member-a');
  assert.deepEqual(plan.importRecords, []);
});

test('UID, UID Google e e-mail duplicados na fonte bloqueiam o lote', () => {
  for (const [users, code] of [
    [[account(), account()], 'SOURCE_UID_COLLISION'],
    [[account(), account('member-b', {providerData: [{providerId: 'google.com', uid: 'google-member-a', email: 'member-b@example.invalid'}]})], 'SOURCE_GOOGLE_UID_COLLISION'],
    [[account(), account('member-b', {email: 'MEMBER-A@example.invalid'})], 'SOURCE_EMAIL_COLLISION']
  ]) {
    const plan = prepare(users);
    assert.equal(hasConflict(plan, code), true, code);
    assert.equal(plan.ready, false);
    assert.deepEqual(plan.importRecords, []);
  }
});

test('duplicações no destino bloqueiam o plano mesmo fora dos usuários a criar', () => {
  const plan = prepare([account()], [account('member-b'), account('member-b')]);
  assert.equal(hasConflict(plan, 'DESTINATION_UID_COLLISION'), true);
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.importRecords, []);
});

test('usuário desativado continua desativado e não corrige destino ativo por importação', () => {
  const disabled = account('member-a', {disabled: true});
  assert.equal(prepare([disabled]).importRecords[0].disabled, true);
  const conflict = prepare([disabled], [account()]);
  assert.equal(hasConflict(conflict, 'DESTINATION_USER_DIFFERS_REQUIRES_REVIEW'), true);
  assert.deepEqual(conflict.importRecords, []);
});

test('whitelist omite claims canceladas e todo segredo ou campo adicional da origem', () => {
  const user = account('member-a', {
    customClaims: {admin: true, managementHomologation: true},
    passwordHash: 'private-fixture', passwordSalt: 'salt-fixture', password: 'password-fixture', refreshToken: 'refresh-fixture', idToken: 'token-fixture', tokensValidAfterTime: 'private-time', metadata: {lastSignInTime: 'private-time'}
  });
  user.providerData[0].accessToken = 'provider-private-fixture';
  const plan = prepare([user]);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.importRecords, [account()]);
  const serialized = JSON.stringify(plan);
  for (const secret of ['private-fixture', 'salt-fixture', 'password-fixture', 'refresh-fixture', 'token-fixture', 'private-time', 'provider-private-fixture']) assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('managementHomologation'), false);
});

test('provider password exige revisão mesmo quando Google também estiver vinculado', () => {
  const user = account();
  user.providerData.push({providerId: 'password', uid: user.email, email: user.email});
  const plan = prepare([user]);
  assert.equal(hasConflict(plan, 'SOURCE_PASSWORD_PROVIDER_REQUIRES_REVIEW'), true);
  assert.deepEqual(plan.importRecords, []);
});

test('destino com vínculo password não é tratado como equivalente Google', () => {
  const target = account();
  target.providerData.push({providerId: 'password', uid: target.email, email: target.email});
  assert.equal(hasConflict(prepare([account()], [target]), 'DESTINATION_PASSWORD_PROVIDER_REQUIRES_REVIEW'), true);
});

test('mapeamento ausente ou remapeamento de UID bloqueia a importação', () => {
  const missing = prepare([account()], [], []);
  assert.equal(hasConflict(missing, 'IDENTITY_MAPPING_MISSING'), true);
  assert.deepEqual(missing.importRecords, []);
  const remapped = prepare([account()], [], [{memberId: 'stable-member-a', faUid: 'member-a', fbUid: 'new-member-a'}]);
  assert.equal(hasConflict(remapped, 'UID_REMAP_REQUIRES_REVIEWED_ADAPTER'), true);
  assert.deepEqual(remapped.importRecords, []);
});

test('membro estável duplicado ou vínculo sem origem bloqueia o lote', () => {
  const users = [account(), account('member-b')];
  const collision = prepare(users, [], mappings(users).map(mapping => ({...mapping, memberId: 'stable-shared'})));
  assert.equal(hasConflict(collision, 'IDENTITY_MAPPING_COLLISION'), true);
  const orphan = prepare([account()], [], [...mappings([account()]), {memberId: 'stable-orphan', faUid: 'orphan', fbUid: 'orphan'}]);
  assert.equal(hasConflict(orphan, 'IDENTITY_MAPPING_SOURCE_USER_MISSING'), true);
});

test('mudança no destino invalida os fingerprints aprovados, inclusive campos não importados', () => {
  const original = prepare([account()], [account('member-b')]);
  const changedTarget = account('member-b', {customClaims: {admin: true}});
  const changed = prepare([account()], [changedTarget], mappings([account()]), {expectedFingerprints: original.fingerprints});
  assert.equal(hasConflict(changed, 'DESTINATION_SNAPSHOT_CHANGED'), true);
  assert.equal(changed.ready, false);
  assert.deepEqual(changed.importRecords, []);
  assert.notEqual(changed.fingerprints.destinationSha256, original.fingerprints.destinationSha256);
  assert.notEqual(changed.resultSha256, original.resultSha256);
});

test('mudança na fonte e no vínculo também invalida a revisão anterior', () => {
  const original = prepare();
  const changed = prepare([account('member-a', {disabled: true})], [], [{memberId: 'other-stable-member', faUid: 'member-a', fbUid: 'member-a'}], {expectedFingerprints: original.fingerprints});
  assert.equal(hasConflict(changed, 'SOURCE_SNAPSHOT_CHANGED'), true);
  assert.equal(hasConflict(changed, 'IDENTITY_MAPPINGS_CHANGED'), true);
  assert.deepEqual(changed.importRecords, []);
});

test('fingerprints são determinísticos pela ordem das chaves e planejamento não altera entradas', () => {
  const users = [account()];
  const snapshotA = source(users);
  const snapshotB = {users, coverage: {complete: true}, readTime: snapshotA.readTime, projectId: snapshotA.projectId, schemaVersion: 1};
  assert.equal(authSnapshotDigest(snapshotA), authSnapshotDigest(snapshotB));
  const original = structuredClone(snapshotA);
  const first = prepareAuthImportPlan(snapshotA, destination([]), mappings(users));
  const second = prepareAuthImportPlan(snapshotB, destination([]), mappings(users));
  assert.equal(first.resultSha256, second.resultSha256);
  assert.deepEqual(snapshotA, original);
});

test('mesmo e-mail com diferenças de caixa mantém equivalência, sem mudar o registro existente', () => {
  const target = account('member-a', {email: 'MEMBER-A@example.invalid'});
  target.providerData[0].email = 'MEMBER-A@example.invalid';
  const before = structuredClone(target);
  const plan = prepare([account()], [target]);
  assert.equal(plan.entries[0].action, 'SKIP');
  assert.deepEqual(target, before);
});

test('snapshot incompleto é recusado e projeto errado produz conflitos bloqueantes', () => {
  assert.throws(() => prepareAuthImportPlan({...source([account()]), coverage: {complete: false}}, destination([]), mappings([account()])), /AUTH_SOURCE_SNAPSHOT_INVALID_OR_INCOMPLETE/);
  const wrong = prepareAuthImportPlan(snapshot('other-source-test', [account()]), destination([]), mappings([account()]));
  assert.equal(hasConflict(wrong, 'SOURCE_PROJECT_MISMATCH'), true);
  assert.deepEqual(wrong.importRecords, []);
  const same = prepareAuthImportPlan(source([account()]), source([]), mappings([account()]));
  assert.equal(hasConflict(same, 'DESTINATION_PROJECT_MUST_DIFFER'), true);
});

test('conflito em um membro impede lote parcial dos outros membros', () => {
  const users = [account(), account('member-b')];
  const plan = prepare(users, [], mappings([users[0]]));
  assert.equal(plan.entries[0].action, 'CREATE');
  assert.equal(plan.entries[1].action, 'CONFLICT');
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.importRecords, []);
});

test('registro com providers malformados vira conflito e nunca produz importação', () => {
  const user = account('member-a', {providerData: {find: 'invalid'}});
  const plan = prepare([user]);
  assert.equal(hasConflict(plan, 'SOURCE_PROVIDERS_INVALID'), true);
  assert.equal(plan.entries[0].action, 'CONFLICT');
  assert.deepEqual(plan.importRecords, []);
});

test('readTime rejeita dias e componentes UTC impossíveis nos dois snapshots', () => {
  const users = [account()];
  for (const readTime of [
    '2026-02-30T12:00:00.000Z', '2026-04-31T12:00:00.000Z',
    '2026-00-15T12:00:00Z', '2026-13-15T12:00:00Z', '2026-01-00T12:00:00Z',
    '2026-01-01T24:00:00Z', '2026-01-01T12:60:00Z', '2026-01-01T12:00:60Z',
    '0000-01-01T12:00:00Z'
  ]) {
    assert.throws(() => prepareAuthImportPlan({...source(users), readTime}, destination([]), mappings(users)), /AUTH_SOURCE_SNAPSHOT_INVALID_OR_INCOMPLETE/, readTime);
    assert.throws(() => prepareAuthImportPlan(source(users), {...destination([]), readTime}, mappings(users)), /AUTH_DESTINATION_SNAPSHOT_INVALID_OR_INCOMPLETE/, readTime);
  }
});

test('readTime aplica a regra gregoriana de ano bissexto', () => {
  const users = [account()];
  for (const readTime of ['2024-02-29T12:00:00Z', '2000-02-29T12:00:00Z', '2400-02-29T12:00:00Z']) {
    assert.equal(prepareAuthImportPlan({...source(users), readTime}, destination([]), mappings(users)).ready, true, readTime);
  }
  for (const readTime of ['2026-02-29T12:00:00Z', '1900-02-29T12:00:00Z', '2100-02-29T12:00:00Z']) {
    assert.throws(() => prepareAuthImportPlan({...source(users), readTime}, destination([]), mappings(users)), /AUTH_SOURCE_SNAPSHOT_INVALID_OR_INCOMPLETE/, readTime);
  }
});

test('readTime preserva frações válidas até nanossegundos sem afirmar freshness operacional', () => {
  const users = [account()];
  for (const fraction of ['', '.1', '.123', '.123456', '.123456789']) {
    const readTime = `2024-02-29T23:59:59${fraction}Z`;
    const plan = prepareAuthImportPlan({...source(users), readTime}, {...destination([]), readTime}, mappings(users));
    assert.equal(plan.sourceReadTime, readTime);
    assert.equal(plan.destinationReadTime, readTime);
    assert.equal(plan.ready, true);
    assert.equal(plan.readiness.scope, 'STRUCTURAL_PREVIEW_ONLY');
    assert.equal(plan.readiness.operationalFreshnessEvaluated, false);
  }
  for (const readTime of ['2024-02-29T23:59:59.Z', '2024-02-29T23:59:59.1234567890Z', '2024-02-29T23:59:59.123+00:00']) {
    assert.throws(() => prepareAuthImportPlan({...source(users), readTime}, destination([]), mappings(users)), /AUTH_SOURCE_SNAPSHOT_INVALID_OR_INCOMPLETE/, readTime);
  }
  const blocked = prepare(users, [], []);
  assert.equal(blocked.readiness.structuralReady, false);
  assert.equal(blocked.readiness.operationalFreshnessEvaluated, false);
});


const unlinked = (id = 'unlinked-a', changes = {}) => account(id, {providerData: [], emailVerified: false, ...changes});
const rawUnlinked = user => ({localId: user.uid, email: user.email, disabled: false, emailVerified: false, providerUserInfo: []});
const deferOptions = (users, {requiredSourceUids = [], rawUsers = users.map(rawUnlinked)} = {}) => ({
  deferUnlinkedSource: true,
  requiredSourceUids,
  expectedRawSnapshotSha256: authRawSnapshotDigest(rawUsers),
  unlinkedSourceEvidence: {
    schemaVersion: 1,
    sourceSnapshotSha256: authSnapshotDigest(source(users)),
    rawSnapshotSha256: authRawSnapshotDigest(rawUsers),
    entries: users.filter(user => Array.isArray(user.providerData) && user.providerData.length === 0 && user.disabled === false && user.emailVerified === false && !requiredSourceUids.includes(user.uid)).map(user => ({
      faUid: user.uid, sourceRecordSha256: authSourceRecordDigest(user), rawRecordSha256: authSourceRecordDigest(rawUsers.find(row => row.localId === user.uid)),
      providerCount: 0, passwordMaterialPresent: false, otherProviderIdentityPresent: false, disabled: false, emailVerified: false
    }))
  }
});
const assertSelectionDenied = plan => { assert.equal(plan.ready, false); assert.equal(plan.selectedImportReady, false); assert.deepEqual(plan.importRecords, []); };

test('modo estrito continua negando 53 sem provedor e preserva todos os 60 vínculos', () => {
  const users = [...Array.from({length: 7}, (_, n) => account('google-' + n)), ...Array.from({length: 53}, (_, n) => unlinked('unlinked-' + n))];
  const plan = prepare(users);
  assertSelectionDenied(plan);
  assert.equal(plan.counts.create, 7);
  assert.equal(plan.counts.conflict, 53);
  assert.equal(plan.counts.deferUnlinked, 0);
  assert.deepEqual(plan.identityMappings, mappings(users));
  assert.equal(plan.selectionPolicy.mode, 'STRICT_GOOGLE_ONLY');
});

test('opt-in privado propõe sete Google, adia53 sem usuário/permissão e não conclui os60', () => {
  const users = [...Array.from({length: 7}, (_, n) => account('google-' + n)), ...Array.from({length: 53}, (_, n) => unlinked('unlinked-' + n))];
  const options = deferOptions(users, {requiredSourceUids: ['google-0', 'google-1', 'google-2']});
  const plan = prepare(users, [], mappings(users), options);
  assert.equal(plan.ready, false);
  assert.equal(plan.selectedImportReady, true);
  assert.equal(plan.allSourceUsersReconciled, false);
  assert.equal(plan.deferredRequiresVerifiedGoogleLink, true);
  assert.equal(plan.counts.create, 7);
  assert.equal(plan.counts.deferUnlinked, 53);
  assert.equal(plan.counts.conflict, 0);
  assert.equal(plan.importRecords.length, 7);
  assert.deepEqual(plan.identityMappings, mappings(users));
  for (const entry of plan.entries.filter(entry => entry.action === 'DEFER_UNLINKED_SOURCE')) {
    assert.equal(Object.hasOwn(entry, 'importRecord'), false);
    assert.equal(Object.hasOwn(entry, 'permissions'), false);
    assert.equal(Object.hasOwn(entry, 'providerData'), false);
    assert.equal(entry.nextRequirement, 'VERIFIED_GOOGLE_LINK_AND_FRESH_IDENTITY_REVIEW');
    assert.match(entry.rawRecordSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(plan.productionAuthorized, false);
  assert.equal(plan.writeEnabled, false);
  assert.equal(plan.readiness.operationalFreshnessEvaluated, false);
  assert.equal(plan.selectionPolicy.evidenceScope, 'PRIVATE_OFFLINE_REVIEW_ONLY');
  assert.equal(plan.resultSha256, authImportPlanDigest(plan));
});

for (const [label, mutate, expectedCode] of [
  ['opt-in de outro tipo', options => {options.deferUnlinkedSource = 'true';}, 'DEFER_UNLINKED_POLICY_INVALID'],
  ['opção desligada com prova', options => {options.deferUnlinkedSource = false;}, 'DEFER_UNLINKED_POLICY_NOT_ENABLED'],
  ['UIDs COPY ausentes', options => {delete options.requiredSourceUids;}, 'REQUIRED_SOURCE_UIDS_INVALID_OR_MISSING'],
  ['UIDs COPY não array', options => {options.requiredSourceUids = {};}, 'REQUIRED_SOURCE_UIDS_INVALID_OR_MISSING'],
  ['UIDs COPY duplicados', options => {options.requiredSourceUids = ['google-a', 'google-a'];}, 'REQUIRED_SOURCE_UIDS_INVALID_OR_MISSING'],
  ['UIDs COPY inválidos', options => {options.requiredSourceUids = ['bad uid'];}, 'REQUIRED_SOURCE_UIDS_INVALID_OR_MISSING'],
  ['UID COPY ausente em Auth', options => {options.requiredSourceUids = ['unknown'];}, 'REQUIRED_SOURCE_UID_NOT_IN_AUTH_SNAPSHOT'],
  ['pin raw ausente', options => {delete options.expectedRawSnapshotSha256;}, 'EXPECTED_RAW_AUTH_SNAPSHOT_FINGERPRINT_INVALID_OR_MISSING'],
  ['pin raw inválido', options => {options.expectedRawSnapshotSha256 = 'BAD';}, 'EXPECTED_RAW_AUTH_SNAPSHOT_FINGERPRINT_INVALID_OR_MISSING'],
  ['evidência ausente', options => {delete options.unlinkedSourceEvidence;}, 'UNLINKED_SOURCE_EVIDENCE_INVALID_OR_MISSING'],
  ['schema errado', options => {options.unlinkedSourceEvidence.schemaVersion = 2;}, 'UNLINKED_SOURCE_EVIDENCE_INVALID_OR_MISSING'],
  ['snapshot normalizado mudou', options => {options.unlinkedSourceEvidence.sourceSnapshotSha256 = '1'.repeat(64);}, 'UNLINKED_SOURCE_EVIDENCE_NORMALIZED_SNAPSHOT_CHANGED'],
  ['snapshot raw mudou', options => {options.unlinkedSourceEvidence.rawSnapshotSha256 = '1'.repeat(64);}, 'UNLINKED_SOURCE_EVIDENCE_RAW_SNAPSHOT_CHANGED'],
  ['prova extra do envelope', options => {options.unlinkedSourceEvidence.passwordHash = 'PRIVATE_PROOF';}, 'UNLINKED_SOURCE_EVIDENCE_INVALID_OR_MISSING'],
  ['prova UID duplicada', options => {options.unlinkedSourceEvidence.entries.push(structuredClone(options.unlinkedSourceEvidence.entries[0]));}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_DUPLICATED'],
  ['prova UID extra', options => {options.unlinkedSourceEvidence.entries.push({...options.unlinkedSourceEvidence.entries[0], faUid: 'google-a'});}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_EXTRA'],
  ['prova UID ausente', options => {options.unlinkedSourceEvidence.entries = [];}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_MISSING'],
  ['digest registro mudou', options => {options.unlinkedSourceEvidence.entries[0].sourceRecordSha256 = '1'.repeat(64);}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_CHANGED'],
  ['digest raw inválido', options => {options.unlinkedSourceEvidence.entries[0].rawRecordSha256 = 'bad';}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID'],
  ['prova registra provedor', options => {options.unlinkedSourceEvidence.entries[0].providerCount = 1;}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID'],
  ['prova senha presente', options => {options.unlinkedSourceEvidence.entries[0].passwordMaterialPresent = true;}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID'],
  ['prova outros provedores', options => {options.unlinkedSourceEvidence.entries[0].otherProviderIdentityPresent = true;}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID'],
  ['prova disabled', options => {options.unlinkedSourceEvidence.entries[0].disabled = true;}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID'],
  ['prova emailVerified', options => {options.unlinkedSourceEvidence.entries[0].emailVerified = true;}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID'],
  ['prova campo adicional privado', options => {options.unlinkedSourceEvidence.entries[0].passwordSalt = 'PRIVATE_PROOF';}, 'UNLINKED_SOURCE_RECORD_EVIDENCE_INVALID']
]) test('opt-in nega ' + label + ' e não libera lote parcial', () => {
  const users = [account('google-a'), unlinked()];
  const options = deferOptions(users);
  mutate(options);
  const plan = prepare(users, [], mappings(users), options);
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, expectedCode), true);
  assert.equal(plan.entries.some(entry => entry.action === 'DEFER_UNLINKED_SOURCE'), false);
  assert.equal(JSON.stringify(plan).includes('PRIVATE_PROOF'), false);
});

test('autor/vínculo COPY requerido sem Google nunca é adiado', () => {
  const users = [account('google-a'), unlinked()];
  const plan = prepare(users, [], mappings(users), deferOptions(users, {requiredSourceUids: ['unlinked-a']}));
  assertSelectionDenied(plan);
  assert.equal(plan.entries[1].action, 'CONFLICT');
  assert.equal(hasConflict(plan, 'SOURCE_REQUIRED_USER_HAS_NO_VERIFIED_GOOGLE_LINK'), true);
  assert.equal(hasConflict(plan, 'SOURCE_GOOGLE_PROVIDER_MISSING_OR_AMBIGUOUS'), true);
});

for (const [label, changes, expectedCode] of [
  ['disabled', {disabled: true}, 'SOURCE_UNLINKED_STATUS_REQUIRES_REVIEW'],
  ['emailVerified', {emailVerified: true}, 'SOURCE_UNLINKED_STATUS_REQUIRES_REVIEW'],
  ['disabled ausente', {disabled: undefined}, 'SOURCE_AUTH_STATUS_MISSING_OR_INVALID'],
  ['emailVerified ausente', {emailVerified: undefined}, 'SOURCE_AUTH_STATUS_MISSING_OR_INVALID'],
  ['providers ausentes', {providerData: undefined}, 'SOURCE_PROVIDERS_INVALID'],
  ['providers null', {providerData: null}, 'SOURCE_PROVIDERS_INVALID'],
  ['provider password', {providerData: [{providerId: 'password', uid: 'unlinked-a@example.invalid'}]}, 'SOURCE_PASSWORD_PROVIDER_REQUIRES_REVIEW'],
  ['provider diferente', {providerData: [{providerId: 'github.com', uid: 'github-unlinked'}]}, 'SOURCE_UNSUPPORTED_PROVIDER_REQUIRES_REVIEW'],
  ['senha no normalizado', {passwordHash: 'PRIVATE_SOURCE'}, 'SOURCE_PASSWORD_MATERIAL_REQUIRES_REVIEW'],
  ['salt vazio', {salt: ''}, 'SOURCE_PASSWORD_MATERIAL_REQUIRES_REVIEW'],
  ['metadata desconhecida', {isAnonymous: true}, 'SOURCE_UNLINKED_METADATA_REQUIRES_REVIEW'],
  ['claims fonte', {customClaims: {admin: true}}, 'SOURCE_UNLINKED_METADATA_REQUIRES_REVIEW']
]) test('opt-in mantém conflito real em fonte: ' + label, () => {
  const users = [account('google-a'), unlinked('unlinked-a', changes)];
  const options = deferOptions(users);
  const plan = prepare(users, [], mappings(users), options);
  assertSelectionDenied(plan);
  assert.equal(plan.entries[1].action, 'CONFLICT');
  assert.equal(hasConflict(plan, expectedCode), true);
  assert.equal(JSON.stringify(plan).includes('PRIVATE_SOURCE'), false);
});

test('evidência lista candidato antes de colisões e não esconde fonte ambígua', () => {
  const users = [account('google-a'), unlinked('unlinked-a', {email: 'GOOGLE-A@example.invalid'})];
  const plan = prepare(users, [], mappings(users), deferOptions(users));
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, 'SOURCE_EMAIL_COLLISION'), true);
  assert.equal(plan.entries[1].action, 'CONFLICT');
});

test('UID providerless duplicado não pode ser atestado uma vez e adiado', () => {
  const users = [unlinked(), unlinked()];
  const options = deferOptions(users);
  options.unlinkedSourceEvidence.entries.pop();
  const plan = prepare(users, [], mappings(users), options);
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, 'UNLINKED_SOURCE_EVIDENCE_SOURCE_UID_AMBIGUOUS'), true);
  assert.equal(plan.entries.some(entry => entry.action === 'DEFER_UNLINKED_SOURCE'), false);
});

for (const [label, target, code] of [
  ['UID existente Google', account('unlinked-a'), 'DESTINATION_UNLINKED_UID_ALREADY_EXISTS_REQUIRES_REVIEW'],
  ['UID existente sem provedor', unlinked(), 'DESTINATION_UNLINKED_UID_ALREADY_EXISTS_REQUIRES_REVIEW'],
  ['e-mail de outro UID', account('target-a', {email: 'UNLINKED-A@example.invalid'}), 'DESTINATION_EMAIL_COLLISION'],
  ['e-mail em provider de outro UID', account('target-a', {providerData: [{providerId: 'google.com', uid: 'google-target-a', email: 'UNLINKED-A@example.invalid'}]}), 'DESTINATION_EMAIL_COLLISION']
]) test('opt-in mantém conflito destino: ' + label, () => {
  const users = [account('google-a'), unlinked()];
  const plan = prepare(users, [target], mappings(users), deferOptions(users));
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, code), true);
  assert.equal(plan.entries[1].action, 'CONFLICT');
});

test('Google selecionado continua revisado: colisão de identidade bloqueia sete/53', () => {
  const users = [account('google-a'), unlinked()];
  const target = account('target-a', {providerData: [{providerId: 'google.com', uid: 'google-google-a', email: 'target-a@example.invalid'}]});
  const plan = prepare(users, [target], mappings(users), deferOptions(users));
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, 'DESTINATION_GOOGLE_UID_COLLISION'), true);
  assert.equal(plan.entries[1].action, 'DEFER_UNLINKED_SOURCE');
  assert.equal(plan.allSourceUsersReconciled, false);
});

test('adiamento não contorna mapping ausente ou remapeado', () => {
  const users = [account('google-a'), unlinked()];
  const missing = prepare(users, [], mappings([users[0]]), deferOptions(users));
  assertSelectionDenied(missing);
  assert.equal(hasConflict(missing, 'IDENTITY_MAPPING_MISSING'), true);
  const changedLinks = mappings(users); changedLinks[1].fbUid = 'another-uid';
  const changed = prepare(users, [], changedLinks, deferOptions(users));
  assertSelectionDenied(changed);
  assert.equal(hasConflict(changed, 'UID_REMAP_REQUIRES_REVIEWED_ADAPTER'), true);
});

test('fingerprints antigos também bloqueiam opt-in sem afirmar frescor da captura', () => {
  const users = [account('google-a'), unlinked()];
  const options = deferOptions(users);
  const original = prepare(users, [], mappings(users), options);
  const changed = prepare(users, [account('target-a')], mappings(users), {...options, expectedFingerprints: original.fingerprints});
  assertSelectionDenied(changed);
  assert.equal(hasConflict(changed, 'DESTINATION_SNAPSHOT_CHANGED'), true);
});

test('digests da revisão são canônicos, preservam entradas e cobrem política/prova', () => {
  const users = [account('google-a'), unlinked()];
  const options = deferOptions(users);
  const before = structuredClone({users, options, links: mappings(users)});
  const plan = prepare(users, [], before.links, options);
  const reordered = structuredClone(options); reordered.unlinkedSourceEvidence.entries.reverse();
  assert.equal(plan.resultSha256, prepare(users, [], before.links, reordered).resultSha256);
  assert.deepEqual({users, options, links: mappings(users)}, before);
  assert.equal(authSourceRecordDigest({b: 2, a: 1}), authSourceRecordDigest({a: 1, b: 2}));
  assert.equal(authRawSnapshotDigest([{b: 2, a: 1}]), authRawSnapshotDigest([{a: 1, b: 2}]));
  assert.throws(() => authRawSnapshotDigest({}), /AUTH_RAW_USERS_ARRAY_REQUIRED/);
  const changedRaw = structuredClone(options);
  changedRaw.expectedRawSnapshotSha256 = '2'.repeat(64);
  changedRaw.unlinkedSourceEvidence.rawSnapshotSha256 = '2'.repeat(64);
  assert.notEqual(plan.inputSha256, prepare(users, [], before.links, changedRaw).inputSha256);
  assert.notEqual(plan.resultSha256, prepare(users).resultSha256);
  assert.equal(Object.hasOwn(plan, 'migrationComplete'), false);
});

test('opções inválidas recusam chamada e limites privados bloqueiam mais de50000 UIDs', () => {
  assert.throws(() => prepare([account()], [], mappings([account()]), []), /AUTH_PLAN_OPTIONS_INVALID/);
  const users = [account('google-a'), unlinked()];
  const options = deferOptions(users);
  options.requiredSourceUids = Array.from({length: 50001}, (_, index) => 'required-' + index);
  assertSelectionDenied(prepare(users, [], mappings(users), options));
  const oversizedProof = deferOptions(users);
  oversizedProof.unlinkedSourceEvidence.entries = Array(50001).fill(oversizedProof.unlinkedSourceEvidence.entries[0]);
  const plan = prepare(users, [], mappings(users), oversizedProof);
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, 'UNLINKED_SOURCE_EVIDENCE_INVALID_OR_MISSING'), true);
});


test('dois UIDs não podem reutilizar pin do mesmo registro raw', () => {
  const users = [account('google-a'), unlinked('unlinked-a'), unlinked('unlinked-b')];
  const options = deferOptions(users);
  options.unlinkedSourceEvidence.entries[1].rawRecordSha256 = options.unlinkedSourceEvidence.entries[0].rawRecordSha256;
  const plan = prepare(users, [], mappings(users), options);
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, 'UNLINKED_SOURCE_RAW_RECORD_EVIDENCE_DUPLICATED'), true);
  assert.equal(plan.counts.deferUnlinked, 0);
});

test('mapping inválido não leva campos privados ao artifact que preserva vínculos válidos', () => {
  const users = [account('google-a'), unlinked()];
  const links = mappings(users);
  links[1].passwordHash = 'PRIVATE_INVALID_MAP';
  const plan = prepare(users, [], links, deferOptions(users));
  assertSelectionDenied(plan);
  assert.equal(hasConflict(plan, 'IDENTITY_MAPPING_INVALID'), true);
  assert.equal(JSON.stringify(plan).includes('PRIVATE_INVALID_MAP'), false);
  assert.deepEqual(plan.identityMappings, [links[0]]);
});
