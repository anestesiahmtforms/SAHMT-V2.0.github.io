import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sessionChangeRevokesAccess, sessionChangeRequiresRender, sessionChangeGrantsAccess} from '../src/session-refresh.js';
import {DEFAULT_APP_FEATURES} from '../src/feature-flags.js';

// Exercise the actual shell callback, so a future unconditional render in main
// cannot silently pass the lower-level session comparison tests.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function sessionChanged(next) {');
const end = source.indexOf('async function refreshAppFeatures', start);
const callback = source.slice(start, end);

const profile = {active: true, access: true, role: 'anestesiologista', sigla: 'FX', displayName: 'Fictício', permissions: {eventsWrite: true, labelsWrite: true}};
const state = (value = profile) => ({status: 'signed-in', user: {uid: 'fictional-user'}, profile: value});

function fixture(route) {
  let replacements = 0;
  const identity = {textContent: profile.displayName};
  const draft = {value: 'rascunho fictício', photo: 'local-fictional-photo', focused: true, dialogOpen: true};
  const context = vm.createContext({
    session: state(), appFeatures: {...DEFAULT_APP_FEATURES}, appFeaturesUid: 'fictional-user', appFeaturesLoadSequence: 0,
    DEFAULT_APP_FEATURES, notice: '', sessionChangeRevokesAccess, sessionChangeRequiresRender, sessionChangeGrantsAccess,
    currentRoute: () => route, scheduleOutboxRetry: () => {}, refreshAppFeatures: () => {},
    updateIdentityProfile: (next) => { identity.textContent = next.profile.displayName; },
    render: () => { replacements++; },
    app: {set innerHTML(value) { replacements++; draft.dialogOpen = false; draft.focused = false; draft.value = ''; draft.photo = null; }}
  });
  vm.runInContext(callback, context);
  return {context, draft, identity, replacements: () => replacements};
}

test('primeiro observador repetido preserva rascunho, foto, foco e diálogo de Eventos/Etiquetas', () => {
  for (const route of ['events', 'labels']) {
    const value = fixture(route);
    value.context.sessionChanged({...state(), offline: false});
    value.context.sessionChanged(state({...profile, displayName: 'Nome fictício atualizado'}));
    assert.equal(value.replacements(), 0);
    assert.deepEqual(value.draft, {value: 'rascunho fictício', photo: 'local-fictional-photo', focused: true, dialogOpen: true});
    assert.equal(value.identity.textContent, 'Nome fictício atualizado');
  }
});

test('revogação real limpa o shell imediatamente; nova sigla também exige nova consulta', () => {
  for (const next of [{...profile, permissions: {}}, {...profile, sigla: 'FY'}, {...profile, access: false}]) {
    const value = fixture('labels');
    value.context.sessionChanged(state(next));
    assert.equal(value.replacements(), 2);
    assert.equal(value.draft.dialogOpen, false);
    assert.equal(value.draft.photo, null);
  }
});
