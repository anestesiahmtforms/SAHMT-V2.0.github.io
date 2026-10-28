const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8').replace(/\r\n/g, '\n');

test('a entrada em Gestão não abre uma área; o clique abre o modal antes de consultar', async () => {
  const start = source.indexOf("    if (route === 'management') {\n      const areaSlug");
  const end = source.indexOf("    } else {\n      const heading", start);
  assert.ok(start >= 0 && end > start, 'Trecho da abertura da área de Gestão não localizado no fixture VM.');
  const handlers = new Map();
  const calls = [];
  const button = {dataset: {managementArea: 'area-1'}, classList: {toggle() {}}, setAttribute() {}, addEventListener: (event, fn) => handlers.set('click', fn)};
  const footer={addEventListener:(_event,fn)=>handlers.set('footer-back',fn)};
  const dialog = {open: false, querySelector:()=>footer, close(){this.open=false;handlers.get('close')();},showModal() {this.open = true; calls.push('modal');}, addEventListener: (event, fn) => handlers.set(event, fn)};
  const content = {isConnected:true, innerHTML: '', querySelector: selector => selector === '#management-area-dialog' ? dialog : selector === '#management-evaluation-access' ? {querySelector:()=>null} : null, querySelectorAll: () => [button]};
  const context = vm.createContext({route: 'management', managementCatalogWasLocal:false, projectAuthOptinEnabled:false, session:{user:{uid:'fictitious'},status:'signed-in',profile:{active:true,access:true}}, evaluationModuleGeneration:0, cleanupCurrentModule:null, currentRoute:()=> 'management', featureEnabledForRoute:()=>true, appFeatures:{}, evaluationUi:{mountManagementEvaluationAccess:()=>()=>{}}, items: [{id: 'area-1', name: 'Gestão clínica'}], selectedManagementAreaId: '', content, can: () => false, MANAGEMENT_AREA_SEED: [], escapeHtml: String, actionForm: () => '<form data-module-form="management"></form>', populateSelect: async () => {}, document: {querySelector: () => null}, managementActivityLoad: 0, loadManagementAreaActivities: async area => {calls.push(area.id);}});
  context.managementAreaIcon=()=>'<span aria-hidden="true"></span>';
  let childLevel=true,cleaned=false;context.cleanupDocumentTraining=()=>{cleaned=true;};context.cleanupDocumentTraining.goBack=()=>{const consumed=childLevel;childLevel=false;return consumed;};
  context.location={hash:'#/management'};
  context.history={state:null,replaceState(_state,_title,hash){context.location.hash=hash;}};
  await vm.runInContext('(async () => {\n' + source.slice(start, end)
    .replace("await import('./performance-ui.js')", 'evaluationUi') + '\n}\n})()', context);
  assert.deepEqual(calls, []);
  assert.match(content.innerHTML, /<dialog class="management-area-dialog"/);
  assert.match(content.innerHTML, /<form data-module-form="management">/);
  await handlers.get('click')();
  assert.deepEqual(calls, ['modal', 'area-1']);
  assert.equal(context.location.hash,'#/management/area-1');
  assert.equal(footer.textContent,'VOLTAR');assert.equal(footer.type,'button');
  handlers.get('footer-back')();assert.equal(dialog.open,true,'folder returns must keep the area open');
  assert.equal(context.location.hash,'#/management/area-1');
  handlers.get('footer-back')();assert.equal(dialog.open,false,'the catalogue root returns to management groups');
  assert.equal(context.managementActivityLoad, 1);assert.equal(cleaned,true,'closing the area cleans sensitive child state');assert.equal(context.cleanupDocumentTraining,null);
  assert.equal(context.location.hash,'#/management');
});

test('a Gestão consolidada não oferece conexão a projetos desativados', () => {
  assert.doesNotMatch(source, /data-project-auth-targets|projectAuthOptinEnabled|getFirebaseProjectAuthOptIn/);
  assert.doesNotMatch(source, /createManagementProjectAuthAutoConnector|managementProjectAuthAutoConnector/);
});
