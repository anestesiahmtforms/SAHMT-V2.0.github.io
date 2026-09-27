import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('manifesta os 307 dias somente após revisão ligada à prévia exata', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'sahmt-schedule-review-'));
  try {
    const checks = ['Prévia privada', 'Revisar registros', 'Confirmar autoria', 'Conferir destino', 'Aprovar escala'];
    const entries = Array.from({length: 307}, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      return {sourceRow: index + 2, candidate: {documentId: date, id: date, date,
        positions: [{position: 1, sigla: 'AB'}], highlights: {siglas: [], events: []}, version: 1},
      sourceIssues: [], manualChecks: ['Conferir posições']};
    });
    const preview = {previewOnly: true, writeEnabled: false, generatedAt: '2026-09-26',
      targetDatabase: 'sahmt-17a16/(default)', source: {revalidation: {scheduleDays: {exactMatches: 307, differences: 0}}},
      globalManualChecks: checks, scheduleDays: entries};
    const previewRaw = JSON.stringify(preview);
    const decisions = {schemaVersion: 1, previewFingerprint: createHash('sha256').update(previewRaw).digest('hex'),
      previewGeneratedAt: preview.generatedAt, targetDatabase: preview.targetDatabase, exportedAt: new Date().toISOString(),
      globalChecks: checks.map((instruction) => ({instruction, checked: true})),
      recordChecks: entries.map(({sourceRow}) => ({category: 'scheduleDays', sourceRow, checked: ['Conferir posições'], unchecked: []}))};
    const previewPath = path.join(folder, 'preview.json');
    const decisionsPath = path.join(folder, 'decisions.json');
    const outputPath = path.join(folder, 'manifest.json');
    await writeFile(previewPath, previewRaw);
    await writeFile(decisionsPath, JSON.stringify(decisions));
    const command = path.resolve('scripts/prepare-schedule-import.js');
    const accepted = spawnSync(process.execPath, [command, previewPath, decisionsPath, outputPath], {encoding: 'utf8'});
    assert.equal(accepted.status, 0, accepted.stderr);
    const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(manifest.count, 307);
    assert.equal(manifest.writeEnabled, false);
    decisions.recordChecks[0].checked = [];
    decisions.recordChecks[0].unchecked = ['Conferir posições'];
    await writeFile(decisionsPath, JSON.stringify(decisions));
    const rejected = spawnSync(process.execPath, [command, previewPath, decisionsPath, path.join(folder, 'blocked.json')], {encoding: 'utf8'});
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /ainda precisa de conferência/);
  } finally {
    await rm(folder, {recursive: true, force: true});
  }
});
