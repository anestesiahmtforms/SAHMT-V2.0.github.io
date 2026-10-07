import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {catalogFolderName, groupCatalogFolders, renderCatalogFolders} from '../src/catalog-folders.js';

const roots = [
  ['1ZVHg-9fcnBv1q8PJgFoUGQ50b5EwAggR', 'Diretrizes', 'DIRETRIZES'],
  ['1jwZn5MeuvsSoyHROk_dNS-mXL1teVfBc', 'Documentos administrativos', 'DOCUMENTOS ADMINISTRATIVOS'],
  ['1gg78vHm0O07B_McXFaMMi_ByGwbbWt-7', 'Protocolos', 'PROTOCOLOS'],
  ['1N0lTv1vewXW_bqhBhN2QG8cq75ZzXdR8', 'ROPs — Segundo semestre de 2026', 'TREINAMENTO DAS ROPs 2026 - SEGUNDO SEMESTRE']
];

test('activities and documents use the same folder for each source', () => {
  for (const [rootId, name, category] of roots) {
    assert.equal(catalogFolderName({rootId}), name);
    assert.equal(catalogFolderName({category}), name);
    assert.equal(catalogFolderName({rootId, category: 'Incorrect category'}), name);
  }
});

test('grouping preserves supplied records, their order and their audiences without creating absent folders', () => {
  const items = [
    {id: 'protocol-b', rootId: roots[2][0], eligibleGroups: ['GENERAL']},
    {id: 'admin-a', rootId: roots[1][0], eligibleGroups: ['RESTRICTED']},
    {id: 'protocol-a', rootId: roots[2][0], eligibleGroups: ['GENERAL']}
  ];
  const before = structuredClone(items);
  const groups = groupCatalogFolders(items);
  assert.deepEqual(groups.map(group => group.name), ['Documentos administrativos', 'Protocolos']);
  assert.deepEqual(groups[1].items.map(item => item.id), ['protocol-b', 'protocol-a']);
  assert.equal(groups[0].items[0], items[1]);
  assert.deepEqual(items, before);
  assert.deepEqual(groupCatalogFolders([]), []);
});

test('new categories are supported without guessing classification from the title', () => {
  const groups = groupCatalogFolders([
    {category: ' Segurança   do paciente ', title: 'ROPs'},
    {category: 'segurança do paciente'},
    {title: 'PROTOCOLO SEM PASTA'}
  ], {fallback: 'Outros treinamentos'});
  assert.equal(groups.find(group => group.name === 'Segurança do paciente').items.length, 2);
  assert.equal(catalogFolderName({title: 'PROTOCOLO SEM PASTA'}, 'Outros treinamentos'), 'Outros treinamentos');
  assert.equal(catalogFolderName({rootId: 'toString'}), 'Outros materiais');
});

test('folders start collapsed, count their own contents and preserve the supplied action markup', () => {
  const items = [{rootId: roots[2][0], id: 'a'}, {rootId: roots[2][0], id: 'b'}];
  const html = renderCatalogFolders(items, item => `<li><button data-open="${item.id}">Abrir</button></li>`, {scope: 'activities', listClass: 'evaluation-activity-list', ordered: true});
  assert.match(html, /<details class="catalog-folder" id="catalog-folder-activities-protocolos">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:\s|=|>)/);
  assert.match(html, /Protocolos<\/span><span class="catalog-folder-count">2 itens/);
  assert.match(html, /<ol class="evaluation-activity-list">/);
  assert.match(html, /data-open="a"/);
  assert.match(html, /data-open="b"/);
  assert.equal(renderCatalogFolders(items, () => '<li></li>', {scope: 'documents', listClass: 'record-list'}).includes('<ul class="record-list">'), true);
});

test('folder labels and attributes escape catalog values and stable ids survive input reordering', () => {
  const items = [{category: '<img src=x onerror="alert(1)">'}];
  const html = renderCatalogFolders(items, () => '<li>Material</li>', {scope: 'documents', listClass: 'record-list'});
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  const render = input => [...renderCatalogFolders(input, () => '<li></li>', {scope: 'activities', listClass: 'evaluation-activity-list'}).matchAll(/<details[^>]+id="([^"]+)"/g)].map(match => match[1]);
  const records = roots.map(([rootId]) => ({rootId}));
  assert.deepEqual(render(records), render([...records].reverse()));
});

test('both visible catalogs use folders while retaining empty states and existing open-details preservation', async () => {
  const [main, performance] = await Promise.all(['main.js', 'performance-ui.js'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')));
  assert.match(main, /renderCatalogFolders\(documents,/);
  assert.match(main, /Nenhum documento publicado nesta área/);
  assert.match(performance, /renderCatalogFolders\(activities,/);
  assert.match(performance, /Nenhuma atividade elegível foi vinculada ainda/);
  assert.match(performance, /details\[open\]/);
  assert.match(performance, /detail\.open = true/);
});
