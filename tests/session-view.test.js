import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sessionChangeRevokesAccess, sessionChangeRequiresRender, sessionChangeGrantsAccess} from '../src/session-refresh.js';
import {DEFAULT_APP_FEATURES, featureEnabledForRoute} from '../src/feature-flags.js';
import {captureReportReadScope} from '../src/report-read-scope.js';

// Exercise the actual shell callback, so a future unconditional render in main
// cannot silently pass the lower-level session comparison tests.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function sessionChanged(next) {');
const end = source.indexOf('async function refreshAppFeatures', start);
const callback = source.slice(start, end);
const scopeSource = source.slice(source.indexOf('function captureReportScope('), source.indexOf('function preloadStartupReports('));
const canSource = source.slice(source.indexOf('function can(permission)'), source.indexOf('function captureWriteSession('));

const profile = {active: true, access: true, role: 'anestesiologista', sigla: 'FX', displayName: 'Fictício', permissions: {eventsWrite: true, labelsWrite: true}};
const state = (value = profile) => ({status: 'signed-in', user: {uid: 'fictional-user'}, profile: value});

function fixture(route) {
  let replacements = 0;
  let clearedReports = 0;
  const identity = {textContent: profile.displayName};
  const draft = {value: 'rascunho fictício', photo: 'local-fictional-photo', focused: true, dialogOpen: true};
  const context = vm.createContext({
    session: state(), appFeatures: {...DEFAULT_APP_FEATURES}, appFeaturesUid: 'fictional-user', appFeaturesLoadSequence: 0,
    DEFAULT_APP_FEATURES, notice: '', sessionChangeRevokesAccess, sessionChangeRequiresRender, sessionChangeGrantsAccess,
    startupBannerActive: false, startupReports: {clear() {clearedReports++;}}, labelManualConfirmation: {uid: '', status: ''},
    captureReportReadScope, featureEnabledForRoute, selectedManagementAreaId: '', reloadOpenReportForScope: null,
    currentRoute: () => route, scheduleOutboxRetry: () => {}, refreshAppFeatures: () => {},
    updateIdentityProfile: (next) => { identity.textContent = next.profile.displayName; },
    render: () => { replacements++; },
    app: {set innerHTML(value) { replacements++; draft.dialogOpen = false; draft.focused = false; draft.value = ''; draft.photo = null; }}
  });
  vm.runInContext(scopeSource + canSource + callback, context);
  return {context, draft, identity, replacements: () => replacements, clearedReports: () => clearedReports};
}

test('primeiro observador repetido preserva rascunho, foto, foco e diálogo de Eventos/Etiquetas', () => {
  for (const route of ['events', 'labels']) {
    const value = fixture(route);
    value.context.sessionChanged({...state(), offline: false});
    value.context.sessionChanged(state({...profile, displayName: 'Nome fictício atualizado'}));
    assert.equal(value.replacements(), 0);
    assert.equal(value.clearedReports(), 0);
    assert.deepEqual(value.draft, {value: 'rascunho fictício', photo: 'local-fictional-photo', focused: true, dialogOpen: true});
    assert.equal(value.identity.textContent, 'Nome fictício atualizado');
  }
});

test('revogação real limpa o shell imediatamente; nova sigla também exige nova consulta', () => {
  for (const next of [{...profile, permissions: {}}, {...profile, sigla: 'FY'}, {...profile, access: false}]) {
    const value = fixture('labels');
    value.context.sessionChanged(state(next));
    assert.equal(value.replacements(), 2);
    assert.equal(value.clearedReports(), 1);
    assert.equal(value.draft.dialogOpen, false);
    assert.equal(value.draft.photo, null);
  }
});

test('loading-profile com UID já conhecido inicia pré-consultas uma vez ao autenticar', () => {
  const value = fixture('home');
  let preloads = 0;
  Object.assign(value.context, {
    session: {status: 'loading-profile', user: {uid: 'fictional-user'}},
    startupBannerActive: true, navigator: {onLine: false},
    preloadStartupReports() {preloads++;}, preloadOperationalDataWhenIdle() {}
  });
  value.context.sessionChanged(state());
  assert.equal(preloads, 1);
  value.context.sessionChanged(state());
  value.context.sessionChanged(state({...profile, displayName: 'Nome atualizado'}));
  assert.equal(preloads, 1);
  assert.equal(value.replacements(), 1);
});
