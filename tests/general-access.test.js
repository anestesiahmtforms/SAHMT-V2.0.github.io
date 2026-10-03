import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {GENERAL_READ_PERMISSIONS, withGeneralReadPermissions} from '../src/general-access.js';

const dataSource = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const functionStart = dataSource.indexOf('export async function saveUserProfile(');
const functionEnd = dataSource.indexOf('\n}', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'saveUserProfile deve existir no código real');
const saveSource = dataSource.slice(functionStart, functionEnd + 2).replace('export ', '') + '\nglobalThis.saveUserProfile = saveUserProfile;';
const plain = (value) => structuredClone(value);

function profileInput(overrides = {}) {
  return {
    uid: 'pessoa-ficticia', email: 'pessoa@example.invalid', displayName: 'Pessoa Fictícia',
    sigla: 'PF', phone: '000000000', role: 'anestesiologista', active: true, access: true,
    permissions: {}, ...overrides
  };
}

function harness({current = null, request = null, readError, commitError, writeError} = {}) {
  const db = {};
  const reads = [];
  const writes = [];
  const queuedBatch = [];
  let batchCount = 0;
  let commitCount = 0;
  let timestampCount = 0;
  const context = vm.createContext({
    db, withGeneralReadPermissions,
    doc: (actualDb, collection, id) => {
      assert.equal(actualDb, db);
      return {collection, id};
    },
    getDocFromServer: async (ref) => {
      reads.push(ref);
      if (readError) throw readError;
      const data = ref.collection === 'users' ? current : request;
      return {exists: () => data !== null, data: () => data};
    },
    serverTimestamp: () => ({serverTimestamp: ++timestampCount}),
    setDoc: async (ref, record) => {
      if (writeError) throw writeError;
      writes.push({kind: 'set', ref: plain(ref), record: plain(record)});
    },
    writeBatch: (actualDb) => {
      assert.equal(actualDb, db);
      batchCount++;
      return {
        set: (ref, record) => queuedBatch.push({kind: 'set', ref: plain(ref), record: plain(record)}),
        update: (ref, record) => queuedBatch.push({kind: 'update', ref: plain(ref), record: plain(record)}),
        commit: async () => {
          commitCount++;
          if (commitError) throw commitError;
          writes.push(...queuedBatch);
        }
      };
    }
  });
  vm.runInContext(saveSource, context);
  return {save: context.saveUserProfile, reads, writes, queuedBatch, batchCount: () => batchCount, commitCount: () => commitCount};
}

test('as duas permissões gerais são explícitas e a lista não pode ser ampliada por mutação', () => {
  assert.deepEqual(GENERAL_READ_PERMISSIONS, ['trainingsRead', 'notificationsRead']);
  assert.equal(Object.isFrozen(GENERAL_READ_PERMISSIONS), true);
  assert.throws(() => GENERAL_READ_PERMISSIONS.push('admin'), TypeError);
});

test('helper concede apenas as duas consultas para perfil aprovado sem mutar o mapa original', () => {
  const permissions = Object.freeze({labelsRead: true, eventsWrite: false, trainingsManage: false, notificationsManage: false, admin: false});
  const result = withGeneralReadPermissions(permissions, {active: true, access: true});
  assert.notEqual(result, permissions);
  assert.deepEqual(result, {...permissions, trainingsRead: true, notificationsRead: true});
  assert.deepEqual(permissions, {labelsRead: true, eventsWrite: false, trainingsManage: false, notificationsManage: false, admin: false});
  result.labelsRead = false;
  assert.equal(permissions.labelsRead, true);
});

test('helper trata consultas ausentes ou false como leitura geral autorizada para aprovados', () => {
  for (const permissions of [undefined, {}, {trainingsRead: false, notificationsRead: false}]) {
    assert.deepEqual(withGeneralReadPermissions(permissions, {active: true, access: true}), {trainingsRead: true, notificationsRead: true});
  }
});

test('helper mantém mapa sem concessão automática quando falta aprovação booleana completa', () => {
  const cases = [undefined, {}, {active: false, access: true}, {active: true, access: false},
    {active: true}, {access: true}, {active: 'true', access: true}, {active: true, access: 1}];
  const permissions = Object.freeze({labelsRead: true, trainingsRead: false, notificationsManage: false});
  for (const flags of cases) {
    const result = withGeneralReadPermissions(permissions, flags);
    assert.deepEqual(result, permissions);
    assert.notEqual(result, permissions);
  }
  assert.deepEqual(withGeneralReadPermissions(), {});
});

test('helper preserva permissões existentes em perfil bloqueado e não as revoga implicitamente', () => {
  const permissions = {trainingsRead: true, notificationsRead: true, trainingsManage: true};
  assert.deepEqual(withGeneralReadPermissions(permissions, {active: false, access: false}), permissions);
});

test('saveUserProfile importa o helper real em vez de duplicar concessões no registro', () => {
  assert.match(dataSource, /import \{withGeneralReadPermissions\} from '\.\/general-access\.js';/);
});

test('novo perfil aprovado recebe somente as duas consultas gerais e conserva metadados normais', async () => {
  const h = harness();
  const input = profileInput();
  const before = structuredClone(input);
  const result = await h.save(input, 'admin-ficticio');
  assert.equal(result.id, 'pessoa-ficticia');
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].ref, {collection: 'users', id: 'pessoa-ficticia'});
  const record = h.writes[0].record;
  assert.deepEqual(record.permissions, {trainingsRead: true, notificationsRead: true});
  assert.equal(record.active, true);
  assert.equal(record.access, true);
  assert.equal(record.role, 'anestesiologista');
  assert.ok(record.createdAt.serverTimestamp);
  assert.ok(record.updatedAt.serverTimestamp);
  assert.deepEqual(h.reads.map((ref) => ref.collection), ['users', 'accessRequests']);
  assert.equal(h.batchCount(), 0);
  assert.deepEqual(input, before);
});

test('perfil existente mantém createdAt e todas as outras permissões aceitas fornecidas pelo formulário', async () => {
  const createdAt = {seconds: 1234, nanoseconds: 0};
  const current = {createdAt, permissions: {eventsRead: true, checklistWrite: true}};
  const h = harness({current});
  const permissions = Object.freeze({eventsRead: true, checklistWrite: true, labelsWrite: true, trainingsManage: true});
  const input = profileInput({permissions});
  const result = await h.save(input, 'admin-ficticio');
  assert.equal(result.createdAt, createdAt);
  assert.deepEqual(h.writes[0].record.createdAt, createdAt);
  assert.deepEqual(h.writes[0].record.permissions, {...permissions, trainingsRead: true, notificationsRead: true});
  assert.deepEqual(current, {createdAt, permissions: {eventsRead: true, checklistWrite: true}});
  assert.equal(permissions.trainingsManage, true);
  assert.equal(Object.hasOwn(permissions, 'notificationsRead'), false);
});

test('perfil aprovado sem mapa ou com leituras false recebe as duas consultas ao salvar', async () => {
  for (const permissions of [undefined, null, {trainingsRead: false, notificationsRead: false}]) {
    const h = harness();
    await h.save(profileInput({permissions}), 'admin-ficticio');
    assert.deepEqual(h.writes[0].record.permissions, {trainingsRead: true, notificationsRead: true});
  }
});

test('saveUserProfile mantém o filtro de IDs conhecidos e de valores exatamente true', async () => {
  const h = harness();
  const input = profileInput({permissions: {
    labelsRead: true, eventsWrite: true, checklistWrite: false,
    usersManage: 'true', admin: 1, financeRead: 'yes', desconhecida: true,
    trainingsRead: false, notificationsRead: false, notificationsManage: false
  }});
  const before = structuredClone(input);
  await h.save(input, 'admin-ficticio');
  assert.deepEqual(h.writes[0].record.permissions, {labelsRead: true, eventsWrite: true, trainingsRead: true, notificationsRead: true});
  assert.deepEqual(input, before);
});

test('salvar perfil não aprovado não acrescenta as consultas gerais nem privilégios administrativos', async () => {
  for (const flags of [{active: false, access: true}, {active: true, access: false}, {active: false, access: false},
    {active: undefined, access: true}, {active: true, access: undefined}, {active: 'true', access: true}, {active: true, access: 1}]) {
    const h = harness();
    const input = profileInput({...flags, permissions: {labelsRead: true, trainingsRead: false, notificationsRead: false}});
    await h.save(input, 'admin-ficticio');
    assert.deepEqual(h.writes[0].record.permissions, {labelsRead: true});
    assert.equal(h.writes[0].record.active, flags.active === true);
    assert.equal(h.writes[0].record.access, flags.access === true);
  }
});

test('normalização de UID, e-mail, nome, sigla, telefone e função é preservada', async () => {
  const h = harness();
  await h.save(profileInput({uid: ' pessoa-ficticia ', email: ' PESSOA@EXAMPLE.INVALID ', displayName: ' Pessoa Fictícia ',
    sigla: ' pf ', phone: ' 000000000 ', role: ' anestesiologista '}), 'admin-ficticio');
  const record = h.writes[0].record;
  assert.equal(record.uid, 'pessoa-ficticia');
  assert.equal(record.email, 'pessoa@example.invalid');
  assert.equal(record.displayName, 'Pessoa Fictícia');
  assert.equal(record.sigla, 'PF');
  assert.equal(record.phone, '000000000');
  assert.equal(record.role, 'anestesiologista');
});

test('a recusa de alteração das próprias permissões continua antes de qualquer consulta ou gravação', async () => {
  for (const permissions of [{}, {trainingsRead: true, notificationsRead: true}, {admin: true}]) {
    const h = harness();
    await assert.rejects(h.save(profileInput({uid: ' admin-ficticio ', permissions}), 'admin-ficticio'), /não pode alterar as próprias permissões/);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.writes, []);
    assert.equal(h.batchCount(), 0);
  }
});

test('entrada inválida continua impedindo consultas e gravações antes da concessão', async () => {
  for (const overrides of [{uid: 'invalid/path'}, {email: 'sem-arroba'}, {displayName: ''}, {sigla: 'x'.repeat(21)},
    {phone: 'x'.repeat(41)}, {role: 'papel-desconhecido'}]) {
    const h = harness();
    await assert.rejects(h.save(profileInput(overrides), 'admin-ficticio'), /Confira UID/);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.writes, []);
  }
});

test('aprovar solicitação PENDING salva o perfil e resolve a solicitação no mesmo lote', async () => {
  const h = harness({request: {status: 'PENDING'}});
  await h.save(profileInput({permissions: {eventsRead: true}}), 'admin-ficticio');
  assert.equal(h.batchCount(), 1);
  assert.equal(h.commitCount(), 1);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].kind, 'set');
  assert.deepEqual(h.writes[0].ref, {collection: 'users', id: 'pessoa-ficticia'});
  assert.deepEqual(h.writes[0].record.permissions, {eventsRead: true, trainingsRead: true, notificationsRead: true});
  assert.equal(h.writes[1].kind, 'update');
  assert.deepEqual(h.writes[1].ref, {collection: 'accessRequests', id: 'pessoa-ficticia'});
  assert.equal(h.writes[1].record.status, 'APPROVED');
  assert.equal(h.writes[1].record.resolvedByUid, 'admin-ficticio');
  assert.ok(h.writes[1].record.resolvedAt.serverTimestamp);
  assert.deepEqual(Object.keys(h.writes[1].record).sort(), ['resolvedAt', 'resolvedByUid', 'status']);
});

test('solicitação já resolvida mantém gravação direta e não altera a solicitação', async () => {
  const h = harness({request: {status: 'APPROVED'}});
  await h.save(profileInput(), 'admin-ficticio');
  assert.equal(h.batchCount(), 0);
  assert.equal(h.commitCount(), 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].ref.collection, 'users');
});

test('falha do lote é propagada sem fallback nem gravação parcial do perfil aprovado', async () => {
  const error = Object.assign(new Error('Falha fictícia de commit'), {code: 'permission-denied'});
  const h = harness({request: {status: 'PENDING'}, commitError: error});
  await assert.rejects(h.save(profileInput(), 'admin-ficticio'), (actual) => actual === error);
  assert.equal(h.commitCount(), 1);
  assert.equal(h.queuedBatch.length, 2);
  assert.deepEqual(h.writes, []);
});

test('erro de leitura ou gravação é propagado sem concessão local nem resultado de sucesso falso', async () => {
  for (const option of ['readError', 'writeError']) {
    const error = Object.assign(new Error('Falha fictícia de acesso'), {code: 'permission-denied'});
    const h = harness({[option]: error});
    await assert.rejects(h.save(profileInput(), 'admin-ficticio'), (actual) => actual === error);
    assert.deepEqual(h.writes, []);
    assert.equal(h.commitCount(), 0);
  }
});
