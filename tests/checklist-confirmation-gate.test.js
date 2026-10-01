import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureReportReadScope} from '../src/report-read-scope.js';
import {createWriteSessionGuard} from '../src/write-session.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = main.indexOf('    const prepareSignature = content.querySelector(', main.indexOf('async function loadDailyChecklist('));
const end = main.indexOf('\n  } catch (error) {', start);
assert.ok(start >= 0 && end > start);
const confirmationSource = main.slice(start, end)
  .replaceAll("import('./checklist-responsibility-reader.js')", "fixtureImport('responsible')")
  .replaceAll("import('./checklist-signature.js')", "fixtureImport('signature')");
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
function element(values = {}) {
  const handlers = new Map();
  return {isConnected: true, disabled: false, textContent: '', ...values,
    addEventListener(type, handler) { handlers.set(type, [...(handlers.get(type) || []), handler]); },
    fire(type) { return Promise.all((handlers.get(type) || []).map(handler => handler())); }
  };
}
async function fixture() {
  const day = '2026-09-22';
  let currentDay = day;
  let session = {status: 'signed-in', user: {uid: 'fictional-signer'},
    profile: {active: true, access: true, role: 'anestesiologista', sigla: 'FX',
      permissions: {checklistSign: true, admin: true}}};
  const reportScope = captureReportReadScope({getSession: () => session,
    getPermissions: current => current.profile.permissions,
    isAllowed: current => current.profile.permissions.checklistSign === true,
    isContextCurrent: () => currentDay === day});
  const prepare = element({disabled: true});
  const name = element();
  const status = element();
  const dialog = element({open: false,
    showModal() { this.open = true; },
    close() { this.open = false; void this.fire('close'); },
    cancel() { void this.fire('cancel'); this.close(); }
  });
  let html = '';
  let children = new Map();
  const previewTarget = {get innerHTML() { return html; }, set innerHTML(value) {
    html = value;
    children = new Map([
      ['#checklist-signature-declaration', element({checked: true})],
      ['#checklist-signature-justification', element({value: 'Justificativa fictícia TESTE'})],
      ['#checklist-signature-confirm', element({disabled: true})]
    ]);
  }, querySelector: selector => children.get(selector), replaceChildren() { html = ''; children.clear(); }};
  const nodes = new Map([
    ['#checklist-signature-prepare', prepare], ['#checklist-responsible-name', name],
    ['#checklist-confirmation-dialog', dialog], ['#checklist-signature-status', status],
    ['#checklist-signature-preview', previewTarget], ['#checklist-confirmation-title', {focus() {}}]
  ]);
  const previews = [];
  const writes = [];
  let refreshes = 0;
  let signatureImports = 0;
  let delayedWriteImport = null;
  const signatureModule = {
    getChecklistSignaturePreview(input) {
      const response = deferred(); previews.push({input, ...response}); return response.promise;
    },
    async signChecklistReport(input) { input.assertCurrent(); writes.push(input); return {status: 'PENDING_VALIDATION'}; }
  };
  const context = vm.createContext({content: {querySelector: selector => nodes.get(selector)},
    reportScope, day, uid: session.user.uid, dayMode: 'today', signatureUnavailableReason: '',
    canPrepareSignature: true, applicableStations: [{id: 'fictional-station', active: true}], records: [], stations: [],
    navigator: {onLine: true}, isCurrent: reportScope.isCurrent,
    can: permission => session.profile.permissions[permission] === true,
    escapeHtml: value => String(value ?? ''), loadDailyChecklist: async () => { refreshes++; },
    captureWriteSession(_route, isAllowed, isContextCurrent) {
      const guard = createWriteSessionGuard({uid: 'fictional-signer', getSession: () => session, isAllowed, isContextCurrent});
      guard.assertCurrent(); return guard;
    }, fixtureImport: async kind => {
      if (kind === 'responsible') return {getChecklistDayResponsible: async input => {
        input.assertCurrent(); return {name: 'Responsável TESTE'};
      }};
      signatureImports++;
      if (signatureImports === 2 && delayedWriteImport) return delayedWriteImport.promise;
      return signatureModule;
    }
  });
  vm.runInContext(confirmationSource, context);
  await flush();
  assert.equal(name.textContent, 'Responsável TESTE');
  assert.equal(prepare.disabled, false);
  return {prepare, dialog, status, previewTarget, previews, writes, signatureModule,
    click: () => prepare.fire('click'), confirm: () => previewTarget.querySelector('#checklist-signature-confirm'),
    delayWriteImport() { delayedWriteImport = deferred(); return delayedWriteImport; },
    refreshes: () => refreshes,
    invalidate(change) {
      if (change === 'day') currentDay = '2026-09-23';
      else if (change === 'uid') session = {...session, user: {uid: 'fictional-other'}};
      else session = {...session, profile: {...session.profile, permissions: {...session.profile.permissions, checklistSign: false}}};
    }};
}
function preview(marker) {
  return {revision: marker, total: 1, missing: 0, declaration: `DECLARAÇÃO TESTE ${marker}`, requestStatus: ''};
}

test('fechar revisão pendente libera botão e permite outra tentativa', {timeout: 2000}, async () => {
  const value = await fixture();
  const first = value.click(); await flush();
  assert.equal(value.prepare.disabled, true);
  value.dialog.close();
  assert.equal(value.prepare.disabled, false);
  value.previews[0].resolve(preview('ANTIGA')); await first;
  assert.equal(value.previewTarget.innerHTML, '');
  const second = value.click(); await flush();
  value.previews[1].resolve(preview('NOVA')); await second;
  assert.match(value.previewTarget.innerHTML, /DECLARAÇÃO TESTE NOVA/);
});

test('fecha e reabre: resposta antiga não substitui nem libera a revisão nova', {timeout: 2000}, async () => {
  const value = await fixture();
  const first = value.click(); await flush(); value.dialog.close();
  const second = value.click(); await flush();
  value.previews[0].resolve(preview('ANTIGA')); await first;
  assert.equal(value.prepare.disabled, true);
  assert.equal(value.previewTarget.innerHTML, '');
  value.previews[1].resolve(preview('NOVA')); await second;
  const current = value.previewTarget.innerHTML;
  assert.match(current, /DECLARAÇÃO TESTE NOVA/);
  assert.doesNotMatch(current, /ANTIGA/);
  assert.equal(value.prepare.disabled, false);
});

test('resposta velha por último e close atrasado preservam revisão reaberta', {timeout: 2000}, async () => {
  const value = await fixture();
  const first = value.click(); await flush(); value.dialog.close();
  const second = value.click(); await flush();
  await value.dialog.fire('close'); // evento enfileirado da abertura anterior
  value.previews[1].resolve(preview('NOVA')); await second;
  const current = value.previewTarget.innerHTML;
  value.previews[0].resolve(preview('ANTIGA')); await first;
  assert.equal(value.previewTarget.innerHTML, current);
  assert.match(current, /DECLARAÇÃO TESTE NOVA/);
});

test('revisão tardia não aplica resultado após mudança de data, UID ou permissão', {timeout: 2000}, async () => {
  for (const change of ['day', 'uid', 'permission']) {
    const value = await fixture(); const pending = value.click(); await flush();
    value.invalidate(change); value.previews[0].resolve(preview('ANTIGA')); await pending;
    assert.equal(value.previewTarget.innerHTML, '', change);
    assert.equal(value.writes.length, 0, change);
  }
});

test('controle da revisão antiga não envia após fechar e reabrir', {timeout: 2000}, async () => {
  const value = await fixture(); const first = value.click(); await flush();
  value.previews[0].resolve(preview('ANTIGA')); await first;
  const oldConfirm = value.confirm();
  value.dialog.close(); const second = value.click(); await flush();
  await oldConfirm.fire('click'); assert.equal(value.writes.length, 0);
  value.previews[1].resolve(preview('NOVA')); await second;
});

test('import atrasado de envio revalida modal antes de registrar pedido', {timeout: 2000}, async () => {
  const value = await fixture(); const preparing = value.click(); await flush();
  value.previews[0].resolve(preview('ATUAL')); await preparing;
  const imported = value.delayWriteImport(); const writing = value.confirm().fire('click'); await flush();
  value.dialog.close(); imported.resolve(value.signatureModule); await writing;
  assert.equal(value.writes.length, 0);
  assert.equal(value.prepare.disabled, false);
});

test('pedido atual continua assíncrono, com UID capturado e guard, e atualiza relatório', {timeout: 2000}, async () => {
  const value = await fixture(); const preparing = value.click(); await flush();
  value.previews[0].resolve(preview('ATUAL')); await preparing;
  await value.confirm().fire('click');
  assert.equal(value.writes.length, 1);
  assert.equal(value.writes[0].uid, 'fictional-signer');
  assert.equal(value.writes[0].revision, 'ATUAL');
  assert.equal(typeof value.writes[0].assertCurrent, 'function');
  assert.equal(value.dialog.open, false);
  assert.equal(value.refreshes(), 1);
});
