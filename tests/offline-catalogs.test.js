import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readThroughSafeCache} from '../src/offline-cache.js';
import {setOfflineRuntimeMode} from '../src/offline-runtime-mode.js';
const source = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');
for (const [name, next, kind, id, data] of [
  ['listLabelStaffSiglas', 'saveLabelStaffSiglas', 'labelStaff', 'all', ['AA', 'BB']],
  ['listEventMembers', 'listUserProfiles', 'eventMembers', 'all', [{sigla: 'AA', name: 'Pessoa sintética'}]]
]) test(`${name} abre a partir do cache do UID sem consultar o backend`, async () => {
  setOfflineRuntimeMode(true);
  try {
    const context = vm.createContext({readThroughSafeCache, readSafeCache: async uid => ({uid, kind, id, cachedAt: Date.now(), data}), writeSafeCache: async () => {}, mayUseOfflineCache: () => true,
      db: {}, getDocFromServer: () => assert.fail('Não consultar servidor'), getDocsFromServer: () => assert.fail('Não consultar servidor'), doc: () => ({}), collection: () => ({}), query: () => ({}), limit: () => ({}), where: () => ({}), orderBy: () => ({})});
    vm.runInContext(source.slice(source.indexOf(`export async function ${name}(`), source.indexOf(`export async function ${next}(`)).replace('export ', ''), context);
    const result = await context[name]({uid: 'fixture-catalog'});
    assert.equal(result.length, data.length); assert.equal(result.stale, true);
    assert.equal(typeof result[0], typeof data[0]);
    if (typeof data[0] === 'string') assert.equal(result[0], 'AA');
  } finally {setOfflineRuntimeMode(false);}
});
