import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  FIRST_LOGIN_COHORTS,
  PROTECTED_FIRST_LOGIN_COHORTS,
  canReclassifyFirstLoginCohort,
  firstLoginCohortAdminEnabled,
  firstLoginCohortForDisplay,
  isFirstLoginCohort
} from '../src/management-first-login-cohort.js';

const dataSource = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const functionStart = dataSource.indexOf('export async function setFirstLoginCohort(');
const functionEnd = dataSource.indexOf('\n}', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'setFirstLoginCohort deve existir no código real');
const functionSource = dataSource.slice(functionStart, functionEnd + 2).replace('export ', '') + '\nglobalThis.setFirstLoginCohort = setFirstLoginCohort;';

function cohortHarness({profile = {uid: 'uid-sintetico'}, readError} = {}) {
  const db = {};
  const updates = [];
  const context = vm.createContext({
    db,
    assertOnlineOperation: () => {},
    FIRST_LOGIN_COHORTS,
    PROTECTED_FIRST_LOGIN_COHORTS,
    doc: (actualDb, collection, id) => {
      assert.equal(actualDb, db);
      return {collection, id};
    },
    getDocFromServer: async () => {
      if (readError) throw readError;
      return {exists: () => profile !== null, data: () => profile};
    },
    updateDoc: async (ref, patch) => updates.push({ref, patch: structuredClone(patch)}),
    serverTimestamp: () => 'SERVER_TIMESTAMP_SENTINEL'
  });
  vm.runInContext(functionSource, context);
  return {set: context.setFirstLoginCohort, updates};
}

test('coortes aceitas são fechadas e valores ausentes/invalidos ficam em REVIEW apenas para exibição', () => {
  assert.deepEqual(FIRST_LOGIN_COHORTS, ['OPERATIONAL', 'STRUCTURAL', 'HOMOLOGATION', 'REVIEW']);
  assert.equal(isFirstLoginCohort('OPERATIONAL'), true);
  assert.equal(isFirstLoginCohort('ADMIN'), false);
  assert.equal(firstLoginCohortForDisplay(undefined), 'REVIEW');
  assert.equal(firstLoginCohortForDisplay('ADMIN'), 'REVIEW');
  assert.deepEqual(PROTECTED_FIRST_LOGIN_COHORTS, ['STRUCTURAL', 'HOMOLOGATION']);
});

test('classificação administrativa começa desativada e só abre com flag explícita', () => {
  assert.equal(firstLoginCohortAdminEnabled({}), false);
  assert.equal(firstLoginCohortAdminEnabled({VITE_MANAGEMENT_FIRST_LOGIN_COHORT_ADMIN_ENABLED: 'false'}), false);
  assert.equal(firstLoginCohortAdminEnabled({VITE_MANAGEMENT_FIRST_LOGIN_COHORT_ADMIN_ENABLED: 'true'}), true);
  assert.match(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'), /VITE_MANAGEMENT_FIRST_LOGIN_COHORT_ADMIN_ENABLED=false/);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /firstLoginCohortAdminUiEnabled && can\('admin'\)/);
  assert.match(main, /firstLoginCohortAdminEnabled\(\)/);
});

test('somente admins podem aprovar mudança de coorte; grupos protegidos não podem ser reclassificados', () => {
  assert.equal(canReclassifyFirstLoginCohort(undefined, 'REVIEW'), true);
  assert.equal(canReclassifyFirstLoginCohort('REVIEW', 'OPERATIONAL'), true);
  assert.equal(canReclassifyFirstLoginCohort('OPERATIONAL', 'STRUCTURAL'), true);
  assert.equal(canReclassifyFirstLoginCohort('STRUCTURAL', 'STRUCTURAL'), true);
  assert.equal(canReclassifyFirstLoginCohort('STRUCTURAL', 'OPERATIONAL'), false);
  assert.equal(canReclassifyFirstLoginCohort('HOMOLOGATION', 'REVIEW'), false);
  assert.equal(canReclassifyFirstLoginCohort('UNKNOWN', 'REVIEW'), false);
  assert.equal(canReclassifyFirstLoginCohort('REVIEW', 'ADMIN'), false);
});

test('setFirstLoginCohort envia somente firstLoginCohort e updatedAt', async () => {
  const h = cohortHarness();
  const result = await h.set('uid-sintetico', 'OPERATIONAL');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {uid: 'uid-sintetico', firstLoginCohort: 'OPERATIONAL', changed: true});
  assert.deepEqual(h.updates, [{
    ref: {collection: 'users', id: 'uid-sintetico'},
    patch: {firstLoginCohort: 'OPERATIONAL', updatedAt: 'SERVER_TIMESTAMP_SENTINEL'}
  }]);
});

test('classificador rejeita entrada inválida, UID divergente, perfis protegidos e falha de leitura sem escrever', async () => {
  const cases = [
    {profile: {uid: 'uid-sintetico', firstLoginCohort: 'STRUCTURAL'}, next: 'OPERATIONAL', message: /protegidas/},
    {profile: {uid: 'uid-sintetico', firstLoginCohort: 'HOMOLOGATION'}, next: 'REVIEW', message: /protegidas/},
    {profile: {uid: 'uid-sintetico', firstLoginCohort: 'UNKNOWN'}, next: 'REVIEW', message: /inválida/},
    {profile: {uid: 'outro-uid'}, next: 'REVIEW', message: /não encontrado ou inconsistente/},
    {profile: null, next: 'REVIEW', message: /não encontrado ou inconsistente/},
    {profile: {uid: 'uid-sintetico'}, next: 'ADMIN', message: /inválidos/},
    {profile: {uid: 'uid-sintetico'}, next: 'REVIEW', uid: '../invalid', message: /inválidos/}
  ];
  for (const item of cases) {
    const h = cohortHarness({profile: item.profile});
    await assert.rejects(h.set(item.uid || 'uid-sintetico', item.next), item.message);
    assert.deepEqual(h.updates, []);
  }
  const error = new Error('read failure synthetic');
  const failedRead = cohortHarness({readError: error});
  await assert.rejects(failedRead.set('uid-sintetico', 'REVIEW'), (actual) => actual === error);
  assert.deepEqual(failedRead.updates, []);
});

test('signInWithPopup atual permanece como implementação Google principal', () => {
  const auth = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');
  assert.match(auth, /export async function signInGoogle\(\)[\s\S]*?signInWithPopup\(api\.auth, provider, api\.browserPopupRedirectResolver\)/);
  assert.match(auth, /if \(!enabled\) return popupSignIn\(\)/);
});
