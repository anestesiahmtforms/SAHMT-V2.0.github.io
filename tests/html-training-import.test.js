import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseQuestionBank, convertStudyHtml, selectQuestionIds, createTrainingRecord, assertPrivateOutput } from '../scripts/lib/html-training-import.js';

const tableBank = `Questão 1\nCódigo da questão\nsource-q1\nPergunta\nQual opção descreve o exemplo?\nDescrição\nExplicação do exemplo.\nPontos\n2\n\nOpção\nTexto\nGabarito\nA\nPrimeira alternativa.\n\nB\nSegunda alternativa.\nRESPOSTA CORRETA\nC\nTerceira alternativa.\n\nD\nQuarta alternativa.\n`;

test('native table-bank parser preserves source codes, points, description and the single answer key', () => {
  const bank = parseQuestionBank(tableBank, { documentId: 'bank-source', expectedCount: 1 });
  assert.deepEqual(bank, [{ id: 'source-q1', stem: 'Qual opção descreve o exemplo?', options: [{ id: 'A', text: 'Primeira alternativa.' }, { id: 'B', text: 'Segunda alternativa.' }, { id: 'C', text: 'Terceira alternativa.' }, { id: 'D', text: 'Quarta alternativa.' }], correctOptionId: 'B', points: 2, comment: 'Explicação do exemplo.' }]);
});

test('normalized table cells preserve the audited pipe-delimited row format', () => {
  const bank = 'Questão 1\nCódigo da questão | stable-q1\nPergunta | Example?\nDescrição | Review note\nPontos | 1\nOpção | Texto | Gabarito\nA | First | \nB | Second | RESPOSTA CORRETA\nC | Third | \nD | Fourth | ';
  const [q] = parseQuestionBank(bank, { documentId: 'doc', expectedCount: 1 });
  assert.equal(q.id, 'stable-q1');
  assert.equal(q.correctOptionId, 'B');
  assert.equal(q.options[3].text, 'Fourth');
});

test('plain banks use the final numbered answer table and never invent missing answers', () => {
  const text = 'Questão 1\nPergunta demonstrativa?\na) Um.\nb) Dois.\nc) Três.\nd) Quatro.\nGABARITO\n1. c';
  assert.equal(parseQuestionBank(text, { documentId: 'doc', expectedCount: 1 })[0].correctOptionId, 'C');
  assert.throws(() => parseQuestionBank(text.replace('1. c', ''), { documentId: 'doc', expectedCount: 1 }), /answer|gabarito/i);
  assert.throws(() => parseQuestionBank(text, { documentId: 'doc', expectedCount: 2 }), /count|quantidade/i);
  assert.throws(() => parseQuestionBank(tableBank.replace('Primeira alternativa.', 'Primeira alternativa.\nRESPOSTA CORRETA'), { documentId: 'doc', expectedCount: 1 }), /answer|gabarito/i);
});

test('export bank parser preserves explicit stable codes and comment across wrapped PDF lines', () => {
  const text = 'BANCO DE QUESTÕES\n01. Pergunta\n ilustrativa?\nCódigo: DEMO-001 | Valor: 1 ponto A) Um. B) Dois. C) Três. D) Quatro. Gabarito: D Justificativa: Comentário\ncompleto.';
  const [q] = parseQuestionBank(text, { documentId: 'pdf-doc', expectedCount: 1 });
  assert.equal(q.id, 'DEMO-001');
  assert.equal(q.stem, 'Pergunta ilustrativa?');
  assert.equal(q.comment, 'Comentário completo.');
  assert.equal(q.options[3].text, 'Quatro.');
});

test('commented plain banks accept an inline numbered key and preserve each full explanation', () => {
  const input = '1. Example?\na) A.\nb) B.\nc) C.\nd) D.\nGabarito comentado\nReferências da fonte.\n1 b\n1 Alternativa b Título\nExplicação com contexto.';
  const [q] = parseQuestionBank(input, { documentId: 'doc', expectedCount: 1 });
  assert.equal(q.correctOptionId, 'B');
  assert.match(q.comment, /Explicação com contexto/);
});

test('study conversion extracts only the article, embeds local images and splits at safe top-level headings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-training-'));
  try {
    await fs.mkdir(path.join(root, 'html', 'assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'html', 'assets', 'figure.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const html = '<html><script>secretKey=1</script><nav>Preview</nav><article class="source-body"><p>Introdução.</p><h2>Primeira etapa</h2><div class="flow"><section class="branch"><h3>Ramo</h3><p>Texto.</p></section></div><table><tr><td><h2>Título interno</h2><img src="assets/figure.png" onerror="bad()"></td></tr></table><h2>Segunda etapa</h2><p><a href="https://docs.google.com/document/d/private">Referência</a></p><script>answerKey=1</script><iframe src="https://bad.test"></iframe></article><footer>Audit prototype</footer></html>';
    const { sections, assets } = await convertStudyHtml(html, { htmlPath: path.join(root, 'html', 'source.html'), auditRoot: root });
    assert.deepEqual(sections.map(s => s.title), ['Introdução', 'Primeira etapa', 'Segunda etapa']);
    assert.equal(assets.length, 1);
    assert.match(sections[1].html, /data:image\/png;base64,iVBOR/);
    assert.match(sections[1].html, /<table>[\s\S]*Título interno[\s\S]*<\/table>/);
    assert.match(sections[1].html, /class="flow"/);
    assert.doesNotMatch(JSON.stringify(sections), /secretKey|answerKey|onerror|iframe|href|https:|Preview|prototype/);
    await fs.writeFile(path.join(root, 'html', 'assets', 'jpeg-labelled.png'), Buffer.from('ffd8ffe000104a464946', 'hex'));
    const jpeg = await convertStudyHtml('<article class="source-body"><img src="assets/jpeg-labelled.png"></article>', { htmlPath: path.join(root, 'html', 'source.html'), auditRoot: root });
    assert.match(jpeg.sections[0].html, /data:image\/jpeg;base64,/);
    await assert.rejects(() => convertStudyHtml('<article class="source-body"><img src="../../outside.png"></article>', { htmlPath: path.join(root, 'html', 'source.html'), auditRoot: root }), /outside|scope|escape/i);
    await assert.rejects(() => convertStudyHtml('<article class="source-body"><img src="https://bad.test/a.png"></article>', { htmlPath: path.join(root, 'html', 'source.html'), auditRoot: root }), /image|remote/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('record preserves the full bank, selects five stable questions and enforces draft until manager assignment', () => {
  const bank = Array.from({ length: 10 }, (_, n) => ({ id: `q${n}`, stem: 'Example', options: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }], correctOptionId: 'A', points: 1 }));
  const topic = { tema: 'Material de exemplo', area: 'ROPs — Comunicação', subarea: 'Comunicação', rop: 1, texto_id: 'doc', banco_id: 'bank', pasta_id: 'folder', auditoria_id: 'audit' };
  const record = createTrainingRecord({ topic, bank, sections: [{ id: 's1', title: 'Study', html: '<p>Example</p>' }], auditSchema: { trainingId: 'rop-training-01', tests: [{ code: 'T1' }] }, documentRevisionId: 'revision-1' });
  assert.equal(record.trainingId, 'rop-training-01');
  assert.equal(record.training.managerUid, '');
  assert.equal(record.training.status, 'DRAFT');
  assert.equal(record.training.audienceGroup, 'GENERAL');
  assert.equal(record.training.source.documentRevisionId, 'revision-1');
  assert.deepEqual(record.training.source.revisions, { document: 'revision-1' });
  assert.equal(record.training.source.pendingInstitutionalReview, true);
  assert.equal(record.training.source.folderId, 'folder');
  assert.equal(record.bank.length, 10);
  assert.equal(new Set(record.selectedQuestionIds).size, 5);
  assert.deepEqual(record.selectedQuestionIds, selectQuestionIds([...bank].reverse(), record.trainingId));
  assert.ok(record.pending.some(p => p.code === 'MANAGER_ASSIGNMENT_REQUIRED'));
  assert.equal(createTrainingRecord({ topic: { ...topic, area: 'Administrativos', rop: undefined }, bank, sections: record.sections }).training.audienceGroup, 'RESTRICTED');
});

test('private import output refuses public paths or sibling folders', () => {
  const root = path.resolve('example-workspace');
  assert.doesNotThrow(() => assertPrivateOutput(root, path.join(root, '.local-preview/html-training-import')));
  for (const output of ['public/training', '.local-preview/other', '../outside']) assert.throws(() => assertPrivateOutput(root, path.resolve(root, output)), /private|output/i);
});

test('private CLI prepares an auditable deterministic manifest and fails closed on missing bank data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-training-cli-'));
  const source = path.join(root, '.local-preview/materials-audit-2026-10-25');
  const write = async (name, value) => { const file = path.join(source, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    const topic = { tema: 'Source example', area: 'Diretrizes', texto_id: 'source', banco_id: 'bank', pasta_id: 'folder', questoes: 5 };
    await write('CURRENT-STATUS.json', { topics: [topic], questions_unique: 5, audit_models: 0, pending_institutional_items: [{ id: 'source', item: 'Pending source review', detail: 'Needs institutional decision.' }] });
    const fiveQuestions = Array.from({ length: 5 }, (_, i) => tableBank.replace('Questão 1', `Questão ${i + 1}`).replace('source-q1', `source-q${i + 1}`)).join('\n');
    await write('corrections/write-plan.private.json', [{ id: 'bank', expectedText: fiveQuestions }]);
    await write('corrections/verification.private.json', { newBanks: [] });
    await write('rops-management/questions.private.json', { questions: [] });
    await write('rops-management/audit-schemas.private.json', []);
    await write('corrections/html/source.html', '<article class="source-body"><h2>Study</h2><p>Complete body.</p></article>');
    const command = path.resolve('scripts/prepare-html-trainings.mjs');
    const run = () => spawnSync(process.execPath, [command, '--workspace', root], { encoding: 'utf8' });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const output = path.join(root, '.local-preview/html-training-import');
    const manifestText = await fs.readFile(path.join(output, 'manifest.private.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.projectId, 'sahmt-gestao-5ae66');
    assert.equal(manifest.trainings[0].bank.length, 5);
    assert.equal(manifest.trainings[0].training.source.documentId, 'source');
    assert.ok(manifest.trainings[0].pending.some(p => p.code === 'SOURCE_REVIEW_REQUIRED'));
    assert.equal(manifest.trainings[0].training.source.pendingInstitutionalReview, true);
    assert.equal(run().status, 0);
    assert.equal(await fs.readFile(path.join(output, 'manifest.private.json'), 'utf8'), manifestText);
    const verify = () => spawnSync(process.execPath, [command, '--workspace', root, '--verify'], { encoding: 'utf8' });
    assert.equal(verify().status, 0);
    await fs.appendFile(path.join(output, 'manifest.private.json'), ' ');
    assert.notEqual(verify().status, 0);
    assert.equal(run().status, 0);
    await write('corrections/html/source.html', '<article class="source-body"><p>Changed original source.</p></article>');
    assert.notEqual(verify().status, 0);
    await write('corrections/write-plan.private.json', []);
    assert.notEqual(run().status, 0);
    assert.equal((await fs.stat(path.join(output, 'diagnostics.private.json'))).isFile(), true);
    await assert.rejects(() => fs.stat(path.join(output, 'manifest.private.json')), /ENOENT/);
    await assert.rejects(() => fs.stat(path.join(output, 'summary.private.json')), /ENOENT/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
