const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
function labelActionHtml({enabled = true, allowed = true} = {}) {
  const start = main.indexOf('function actionForm(route)');
  const end = main.indexOf('function shellView()', start);
  assert.ok(start >= 0 && end > start);
  const ctx = vm.createContext({
    can: permission => allowed && ['labelsWrite', 'labelsManage'].includes(permission),
    labelAiEnabled: enabled,
    session: {user: {uid: 'fictional-user'}},
    labelManualConfirmation: {uid: '', status: ''},
    renderLabelManualConfirmation: () => '',
    todayInputValue: () => '2026-10-02'
  });
  vm.runInContext(main.slice(start, end), ctx);
  return ctx.actionForm('labels');
}
function elementById(html, tag, id) {
  return html.match(new RegExp('<' + tag + '\\b[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</' + tag + '>'));
}

test('Etiqueta mantém somente Abrir câmera e Registro manual no bloco principal', () => {
  const html = labelActionHtml();
  const actions = html.match(/<div class="label-action-grid">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(actions, /id="label-camera-open">ABRIR CÂMERA<\/button>/);
  assert.match(actions, /id="label-manual-open"/);
  assert.equal([...actions.matchAll(/<button\b/g)].length, 2);
  assert.doesNotMatch(html, /label-read-ai|>LER ETIQUETA</);
  assert.equal(/querySelector\(['"]#label-read-ai['"]\)/.test(main), false);
});

test('modal da câmera mostra CAPTURAR E LER e FECHAR abaixo da captura', () => {
  const html = labelActionHtml();
  const dialog = elementById(html, 'dialog', 'label-camera-dialog')?.[1] || '';
  assert.match(dialog, /id="label-camera-capture"[^>]*>CAPTURAR E LER<\/button>/);
  assert.match(dialog, /id="label-camera-close"[^>]*>FECHAR<\/button>/);
  assert.ok(dialog.indexOf('id="label-camera-capture"') < dialog.indexOf('id="label-camera-close"'));
  const header = dialog.match(/<header>([\s\S]*?)<\/header>/)?.[1] || '';
  assert.doesNotMatch(header, /label-camera-close/);
});

test('captura aciona diretamente a leitura e desmontagem descarta respostas antigas', () => {
  const start = main.indexOf("if (route === 'labels') {", main.indexOf('async function bindEvents'));
  const relevant = start >= 0 ? main.slice(start) : main;
  assert.equal(/bindLabelCamera\(workspace,\s*\{\s*onCaptured:\s*[\w.]+\.readCapture\s*\}\)/.test(relevant), true);
  assert.equal(/(?:cleanupAi|labelAi)\.dispose\(\)/.test(relevant), true);
});

test('grade principal usa duas linhas em todas as regras responsivas sem espaço para Ler Etiqueta', () => {
  const finalSection = css.slice(css.indexOf('/* Etiquetas: botões empilhados'));
  const rules = [...finalSection.matchAll(/\.app-shell--labels \.label-action-grid\{([^}]+)\}/g)]
    .map(match => match[1]).filter(body => body.includes('grid-template-rows:'));
  assert.ok(rules.length >= 3, 'Regras geral, largura móvel e altura pequena devem continuar explícitas.');
  for (const rule of rules) {
    assert.doesNotMatch(rule, /repeat\(2,/);
    const rows = rule.match(/grid-template-rows:([^;]+)/)?.[1] || '';
    const trackCount = (rows.match(/minmax\(/g) || []).length;
    assert.equal(trackCount, 2, rows);
  }
  assert.match(finalSection, /#label-manual-open\{[^}]*grid-row:2/);
  assert.doesNotMatch(finalSection, /#label-read-ai/);
});

test('IA desativada preserva registro manual e câmera, sem instruir botão removido', () => {
  const html = labelActionHtml({enabled: false});
  assert.match(html, /id="label-manual-open"/);
  assert.match(html, /Leitura por IA desativada/);
  assert.doesNotMatch(html, /toque em Ler Etiqueta/i);
  assert.equal(labelActionHtml({allowed: false}), '');
});
