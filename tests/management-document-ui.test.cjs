const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const functionStart = main.indexOf('async function loadManagementAreaActivities(area) {');
const functionEnd = main.indexOf('\nasync function loadActivityInteractions(', functionStart);
const functionSource = main.slice(functionStart, functionEnd).replaceAll("await import('./data.js')", 'await loadData()');
const accessPromise = import(pathToFileURL(join(__dirname, '../src/management-document-access.js')));

const protectedArea = {id: 'area-gestao-de-documentos', name: 'Gestão de Documentos', active: true, managerUids: ['area-manager'], memberUids: []};
const groups = [
  {id: 'general', managementAreaId: protectedArea.id, name: 'ACESSO GERAL', category: 'ACESSO GERAL', accessMode: 'GENERAL', sourceFolderId: 'general-folder', active: true, version: 1, allowedEmails: ['reader@example.test'], managerEmails: ['manager@example.test']},
  {id: 'restricted', managementAreaId: protectedArea.id, name: 'ACESSO RESTRITO', category: 'POLITICAS E REGIMENTOS', accessMode: 'RESTRICTED', sourceFolderId: 'restricted-folder', active: true, version: 1, allowedEmails: ['restricted@example.test'], managerEmails: []}
];
const docs = groups.map((group) => ({id: group.id + '-doc', managementAreaId: protectedArea.id, documentGroupId: group.id, title: group.name + ' documento fictício', category: group.category, active: false, requiredReading: false, version: 1, driveUrl: 'https://drive.google.com/file/d/fictitious-' + group.id + '/view'}));

async function fixture({uid = 'admin', email = 'admin@example.test', permissions = ['documentsManage', 'managementRead'], area = protectedArea, documents = docs, documentGroups = groups, onImport, onSave} = {}) {
  const helpers = await accessPromise;
  const calls = [];
  const writes = [];
  const forms = new Map();
  const handlers = new Map();
  const state = {permissions: new Set(permissions)};
  function form(id, names) {
    const controls = Object.fromEntries(names.map((name) => [name, {name, value: name === 'managementAreaId' ? area.id : name === 'version' ? '0' : '', checked: false, disabled: false, readOnly: false, addEventListener(event, fn) {handlers.set(id + ':' + name + ':' + event, fn);}, focus() {}}]));
    const status = {textContent: ''};
    const submit = {disabled: false};
    const result = {elements: controls, dataset: {}, isConnected: true, addEventListener(event, fn) {handlers.set(id + ':' + event, fn);}, querySelector(selector) {return selector === '[type="submit"]' ? submit : status;}, reset() {for (const field of Object.values(controls)) {field.value = field.name === 'managementAreaId' ? area.id : field.name === 'version' ? '0' : ''; field.checked = false;}}, scrollIntoView() {}};
    forms.set('#' + id, result);
    return result;
  }
  const documentForm = form('management-document-form', ['managementAreaId', 'documentId', 'version', 'title', 'category', 'description', 'driveUrl', 'documentGroupId', 'active', 'requiredReading']);
  const groupForm = form('management-document-group-form', ['managementAreaId', 'groupId', 'version', 'name', 'category', 'accessMode', 'sourceFolderId', 'allowedEmails', 'managerEmails', 'active']);
  const details = {'#management-document-editor': {open: false}, '#management-document-group-editor': {open: false}};
  const detail = {
    innerHTML: '', isConnected: true,
    querySelector(selector) {
      if (forms.has(selector) && this.innerHTML.includes('id="' + selector.slice(1) + '"')) return forms.get(selector);
      if (details[selector] && this.innerHTML.includes('id="' + selector.slice(1) + '"')) return details[selector];
      if (this.innerHTML.includes('id="' + selector.slice(1) + '"')) return {addEventListener(event, fn) {handlers.set(selector + ':' + event, fn);}};
      return null;
    },
    querySelectorAll(selector) {
      const attribute = selector === '[data-document-edit]' ? 'data-document-edit' : selector === '[data-document-group-edit]' ? 'data-document-group-edit' : null;
      if (!attribute) return [];
      return [...this.innerHTML.matchAll(new RegExp(attribute + '="([^"]+)"', 'g'))].map((match) => ({dataset: attribute === 'data-document-edit' ? {documentEdit: match[1]} : {documentGroupEdit: match[1]}, addEventListener(event, fn) {handlers.set(attribute + ':' + match[1] + ':' + event, fn);}}));
    }
  };
  let imports = 0;
  const api = {
    listManagementActivities: async () => [], listManagementIndicators: async () => [], listManagementActionPlans: async () => [], listManagementActionPlanItems: async () => [], listIndicatorMeasurements: async () => [], listManagementActivityScoreReviews: async () => [], getManagementTaskScoringRule: async () => null,
    listManagementDocumentGroups: async (areaId, options) => {calls.push({kind: 'groups', areaId, options}); return documentGroups;},
    listManagementDocuments: async (areaId, options) => {calls.push({kind: 'documents', areaId, options}); return documents;},
    saveManagementDocument: async (values, writeUid, options) => {await onSave?.(context, 'document'); options.assertCurrent(); writes.push({kind: 'document', values, uid: writeUid});},
    saveManagementDocumentGroup: async (values, writeUid, options) => {await onSave?.(context, 'group'); options.assertCurrent(); writes.push({kind: 'group', values, uid: writeUid});}
  };
  const context = vm.createContext({
    ...helpers, managementActivityLoad: 0, selectedManagementAreaId: area.id, appFeatures: {}, notice: '',
    session: {status: 'signed-in', user: {uid, email, emailVerified: true}, profile: {active: true, access: true}},
    document: {querySelector: selector => selector === '#management-area-detail' ? detail : null},
    can: permission => state.permissions.has(permission), currentRoute: () => 'management', featureEnabledForRoute: () => true,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'), indicatorPeriodValue: () => '2026-10', todayInputValue: () => '2026-10-02', formatRecordDate: String,
    render: async () => {calls.push({kind: 'render'});}, crypto: {randomUUID: () => 'stable-mutation-id'},
    FormData: class {constructor(form) {this.form = form;} entries() {return Object.entries(this.form.elements).filter(([, field]) => !field.disabled).map(([name, field]) => [name, field.value]);}},
    loadData: async () => {imports += 1; if (imports > 1) await onImport?.(context); return api;},
    window: {confirm: () => false}
  });
  vm.runInContext(functionSource, context);
  await context.loadManagementAreaActivities(area);
  assert.doesNotMatch(detail.innerHTML, /Não foi possível carregar/, detail.innerHTML);
  documentForm.elements.documentGroupId.disabled = /name="documentGroupId"[^>]*disabled/.test(detail.innerHTML);
  return {context, calls, writes, documentForm, groupForm, detail, handlers, state};
}

function fillDocument(form) {
  form.elements.title.value = 'Documento fictício';
  form.elements.category.value = 'ACESSO GERAL';
  form.elements.driveUrl.value = 'https://drive.google.com/file/d/fictitious-doc/view';
  form.elements.documentGroupId.value = 'general';
}

test('Gestão de Documentos separa grupos, oferece configuração apenas ao administrador e começa documento inativo', async () => {
  const result = await fixture();
  assert.deepEqual(result.calls.map((call) => call.kind), ['groups', 'documents']);
  assert.match(result.detail.innerHTML, /<h5>ACESSO GERAL · 1<\/h5>/);
  assert.match(result.detail.innerHTML, /<h5>ACESSO RESTRITO · 1<\/h5>/);
  assert.match(result.detail.innerHTML, /id="management-document-group-editor"/);
  assert.match(result.detail.innerHTML, /<input name="active" type="checkbox" > Documento ativo/);
  assert.match(result.detail.innerHTML, /id="management-document-reset"/);
  fillDocument(result.documentForm);
  await result.handlers.get('management-document-form:submit')({preventDefault() {}, currentTarget: result.documentForm});
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].uid, 'admin');
  assert.equal(result.writes[0].values.documentId, 'stable-mutation-id');
  assert.equal(result.writes[0].values.active, false);
});

test('gestor do grupo edita apenas documentos existentes do seu grupo sem mudar classificação nem criar grupo', async () => {
  const result = await fixture({uid: 'manager', email: 'manager@example.test', permissions: ['managementRead']});
  assert.doesNotMatch(result.detail.innerHTML, /id="management-document-group-editor"/);
  assert.doesNotMatch(result.detail.innerHTML, /id="management-document-reset"/);
  assert.match(result.detail.innerHTML, /name="documentGroupId" required disabled/);
  assert.match(result.detail.innerHTML, /data-document-edit="general-doc"/);
  assert.doesNotMatch(result.detail.innerHTML, /data-document-edit="restricted-doc"/);
  assert.equal(result.documentForm.querySelector('[type="submit"]').disabled, true);
  result.handlers.get('data-document-edit:general-doc:click')();
  assert.equal(result.documentForm.elements.category.readOnly, true);
  assert.equal(result.documentForm.querySelector('[type="submit"]').disabled, false);
  await result.handlers.get('management-document-form:submit')({preventDefault() {}, currentTarget: result.documentForm});
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].values.documentGroupId, 'general');
});

test('leitor não recebe editor de grupo nem editor de documento', async () => {
  const result = await fixture({uid: 'reader', email: 'reader@example.test', permissions: ['managementRead'], documents: [docs[0]], documentGroups: [groups[0]]});
  assert.doesNotMatch(result.detail.innerHTML, /id="management-document-group-editor"|id="management-document-editor"|data-document-edit/);
});

test('outras áreas mantêm consulta sem grupos e criação ativa de documento legado', async () => {
  const area = {...protectedArea, id: 'area-gestao-da-qualidade', name: 'Gestão da Qualidade'};
  const result = await fixture({area, documents: []});
  assert.deepEqual(result.calls.map((call) => call.kind), ['documents']);
  assert.doesNotMatch(result.detail.innerHTML, /name="documentGroupId"|id="management-document-group-editor"/);
  assert.match(result.detail.innerHTML, /<input name="active" type="checkbox" checked> Documento ativo/);
});

test('troca de sessão enquanto o import aguarda impede gravação com a nova conta', async () => {
  const result = await fixture({onImport: context => {context.session.user.uid = 'new-user';}});
  fillDocument(result.documentForm);
  await result.handlers.get('management-document-form:submit')({preventDefault() {}, currentTarget: result.documentForm});
  assert.equal(result.writes.length, 0);
});

test('revogação da aprovação dentro da transação impede salvar documento', async () => {
  const result = await fixture({onSave: context => {context.session.profile.access = false;}});
  fillDocument(result.documentForm);
  await result.handlers.get('management-document-form:submit')({preventDefault() {}, currentTarget: result.documentForm});
  assert.equal(result.writes.length, 0);
  assert.match(result.documentForm.querySelector('#management-document-status').textContent, /acesso ou a área mudou/);
});

test('grupos normalizam e-mails antes da escrita e capturam o UID autorizado', async () => {
  const result = await fixture();
  result.groupForm.elements.name.value = 'ACESSO GERAL';
  result.groupForm.elements.category.value = 'ACESSO GERAL';
  result.groupForm.elements.accessMode.value = 'GENERAL';
  result.groupForm.elements.allowedEmails.value = 'Reader@Example.Test\nreader@example.test';
  result.groupForm.elements.managerEmails.value = 'Manager@Example.Test';
  await result.handlers.get('management-document-group-form:submit')({preventDefault() {}, currentTarget: result.groupForm});
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].uid, 'admin');
  assert.deepEqual(result.writes[0].values.allowedEmails, ['reader@example.test']);
  assert.deepEqual(result.writes[0].values.managerEmails, ['manager@example.test']);
});
test('gestor da área preserva documento legado sem enviar grupo vazio nem reclassificar', async () => {
  const legacy = {...docs[0], documentGroupId: undefined};
  const result = await fixture({uid: 'area-manager', email: 'area-manager@example.test', permissions: ['managementRead'], documents: [legacy]});
  result.handlers.get('data-document-edit:general-doc:click')();
  await result.handlers.get('management-document-form:submit')({preventDefault() {}, currentTarget: result.documentForm});
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].values.documentGroupId, undefined);
});

test('revogar managementRead bloqueia gestor do grupo antes de confirmar gravação', async () => {
  let result;
  result = await fixture({uid: 'manager', email: 'manager@example.test', permissions: ['managementRead'], onSave: () => {result.state.permissions.delete('managementRead');}});
  result.handlers.get('data-document-edit:general-doc:click')();
  await result.handlers.get('management-document-form:submit')({preventDefault() {}, currentTarget: result.documentForm});
  assert.equal(result.writes.length, 0);
  assert.match(result.documentForm.querySelector('#management-document-status').textContent, /acesso para editar este documento foi revogado/);
});

test('fechar a área enquanto a escrita aguarda impede confirmar o grupo na tela antiga', async () => {
  const result = await fixture({onImport: context => {context.managementActivityLoad += 1;}});
  result.groupForm.elements.name.value = 'ACESSO GERAL';
  result.groupForm.elements.category.value = 'ACESSO GERAL';
  result.groupForm.elements.accessMode.value = 'GENERAL';
  result.groupForm.elements.allowedEmails.value = 'reader@example.test';
  result.groupForm.elements.managerEmails.value = 'manager@example.test';
  await result.handlers.get('management-document-group-form:submit')({preventDefault() {}, currentTarget: result.groupForm});
  assert.equal(result.writes.length, 0);
});
test('gravação em andamento impede segundo envio e troca do documento no editor', async () => {
  let finish;
  let started;
  const inFlight = new Promise(resolve => {started = resolve;});
  const pending = new Promise(resolve => {finish = resolve;});
  const result = await fixture({onSave: async () => {started(); await pending;}});
  result.handlers.get('data-document-edit:general-doc:click')();
  const submit = () => result.handlers.get('management-document-form:submit')({preventDefault() {}, currentTarget: result.documentForm});
  const first = submit();
  await inFlight;
  result.handlers.get('data-document-edit:restricted-doc:click')();
  assert.equal(result.documentForm.elements.documentId.value, 'general-doc');
  await submit();
  assert.equal(result.writes.length, 0);
  finish();
  await first;
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].values.documentId, 'general-doc');
});