import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authImportPlanDigest, authSnapshotDigest, prepareAuthImportPlan} from '../scripts/lib/management-auth-import-plan.js';

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
