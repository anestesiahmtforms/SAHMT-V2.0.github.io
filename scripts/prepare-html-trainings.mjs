import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseQuestionBank, convertStudyHtml, createTrainingRecord, assertPrivateOutput, sha256 } from './lib/html-training-import.js';

// All content-bearing inputs and outputs stay in the ignored private workspace.
// This command has no network client and never imports or publishes anything.
export async function prepareHtmlTrainings({ workspaceRoot = process.cwd() } = {}) {
  const workspace = await fs.realpath(workspaceRoot);
  const auditRoot = path.join(workspace, '.local-preview/materials-audit-2026-10-25');
  const output = path.join(workspace, '.local-preview/html-training-import');
  assertPrivateOutput(workspace, output);
  const privateParent = await fs.realpath(path.join(workspace, '.local-preview'));
  if (privateParent !== path.join(workspace, '.local-preview')) throw new Error('Private output parent must not be a symlink');
  await fs.mkdir(output, { recursive: true });
  if (await fs.realpath(output) !== output) throw new Error('Private output must not be a symlink');
  // Revoke any stale importable artifact before trying to prepare a new batch.
  for (const name of ['manifest.private.json', 'sha256.private.json', 'summary.private.json', 'diagnostics.private.json']) await fs.rm(path.join(output, name), { force: true });
  const sourceHashes = new Map(); const diagnostics = [];
  async function read(relative, optional = false) {
    const file = path.resolve(auditRoot, relative);
    const rel = path.relative(auditRoot, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Source escapes private audit scope');
    try {
      const realFile = await fs.realpath(file); const realRoot = await fs.realpath(auditRoot);
      const realRel = path.relative(realRoot, realFile);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error('Source realpath escapes private audit scope');
      const data = await fs.readFile(realFile);
      sourceHashes.set(relative.replaceAll(path.sep, '/'), { sha256: sha256(data), bytes: data.length });
      return data.toString('utf8');
    } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  }
  const json = async (name, optional = false) => { const raw = await read(name, optional); return raw === null ? null : JSON.parse(raw); };
  const documents = new Map(); const revisions = new Map(); const bankText = new Map();
  function nativeText(value) {
    if (!value || typeof value !== 'object') return '';
    if (value.textRun) return value.textRun.content || '';
    return Object.values(value).map(v => Array.isArray(v) ? v.map(nativeText).join('') : nativeText(v)).join('');
  }
  function register(doc) {
    const id = doc.documentId || doc.id; if (!id) return;
    if (doc.revisionId || doc.revision) revisions.set(id, doc.revisionId || doc.revision);
    const text = doc.text ?? (doc.paragraphs ? doc.paragraphs.map(p => p.text || '').join('') : doc.tabs?.some(t => typeof t.text === 'string') ? doc.tabs.map(t => t.text || '').join('\n') : nativeText(doc.tabs || doc.body));
    if (text) documents.set(id, text);
  }
  async function registerDirectory(relative) {
    let names; try { names = await fs.readdir(path.join(auditRoot, relative)); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const name of names.filter(n => n.endsWith('.json')).sort()) register(await json(`${relative}/${name}`));
  }
  try {
    const status = await json('CURRENT-STATUS.json');
    if (!Array.isArray(status.topics) || !status.topics.length) throw new Error('No official source topic inventory');
    for (const dir of ['administrativos/native', 'protocolos/before', 'diretrizes/snapshots']) await registerDirectory(dir);
    for (const doc of await json('administrativos/after/normalized.json', true) || []) register(doc);
    await registerDirectory('diretrizes/normalized-after');
    for (const doc of (await json('final-normalized.json', true))?.documents || []) register(doc);
    const ropSnapshot = await json('rops-management/snapshot.private.json', true);
    for (const entry of ropSnapshot?.entries || []) for (const doc of entry.documents || []) register(doc.normalized);
    for (const correction of await json('corrections/write-plan.private.json')) if (typeof correction.expectedText === 'string') bankText.set(correction.id, correction.expectedText);
    const verification = await json('corrections/verification.private.json');
    for (const bank of verification.newBanks || []) {
      const topic = status.topics.find(t => t.banco_id === bank.id);
      if (!topic || topic.pasta_id !== bank.folder || topic.texto_id !== bank.source) throw new Error(`New bank official folder/source mismatch: ${bank.id}`);
      bankText.set(bank.id, bank.text);
    }
    // Revision IDs are evidence from saved reads, never invented or assumed current.
    for (const item of (await json('corrections/final-verification.json', true))?.checks || []) if (item.revision) revisions.set(item.id, item.revision);
    const ropQuestions = (await json('rops-management/questions.private.json')).questions;
    const schemas = await json('rops-management/audit-schemas.private.json');
    const report = await json('corrections/report-data.private.json', true);
    const trainings = []; const usedSchemas = new Set(); const usedQuestionDocs = new Set(); const assetHashes = new Map();
    for (const topic of status.topics) {
      try {
        if (usedQuestionDocs.has(topic.banco_id)) throw new Error('A question source is mapped to multiple official topics');
        usedQuestionDocs.add(topic.banco_id);
        let bank;
        if (topic.rop) {
          bank = ropQuestions.filter(q => q.sourceDocumentId === topic.banco_id).map(({ id, stem, options, correctOptionId, points, comment }) => ({ id, stem, options, correctOptionId, points, ...(comment ? { comment } : {}) }));
          if (bank.length !== topic.questoes || bank.some(q => !q.stem || q.options.length !== 4 || !q.options.some(o => o.id === q.correctOptionId))) throw new Error('Incomplete ROP question source bank');
        } else {
          let text = bankText.get(topic.banco_id) || documents.get(topic.banco_id);
          if (!text && topic.tema.includes('ROTEM')) text = await read('protocolos/ROTEM-banco-convertido.txt');
          if (!text) throw new Error('No parseable local source bank');
          bank = parseQuestionBank(text, { documentId: topic.banco_id, expectedCount: topic.questoes });
        }
        const signature = report?.bankChecks?.find(b => b.id === topic.banco_id && b.tableSignatureAvailable)?.signature;
        if (signature && (signature.length !== bank.length || signature.some((q, i) => q.code !== bank[i].id || Number(q.points) !== bank[i].points || q.key !== bank[i].correctOptionId))) throw new Error('Preserved source bank codes/points/keys do not match audit signature');
        const relativeHtml = topic.preview || `corrections/html/${topic.texto_id}.html`;
        const { sections, assets } = await convertStudyHtml(await read(relativeHtml), { htmlPath: path.join(auditRoot, relativeHtml), auditRoot });
        for (const image of assets) assetHashes.set(image.path, { sha256: image.sha256, bytes: image.bytes });
        const auditSchema = topic.rop ? schemas.find(s => s.sourceId === topic.auditoria_id && Number(s.ropNumber) === Number(topic.rop)) : null;
        if (topic.rop && !auditSchema) throw new Error('Missing official ROP audit schema mapping');
        if (auditSchema) usedSchemas.add(auditSchema.id);
        const pending = (status.pending_institutional_items || []).filter(p => [p.id, p.source_id].some(id => id && [topic.texto_id, topic.banco_id].includes(id))).map(p => ({ code: 'SOURCE_REVIEW_REQUIRED', ...p }));
        pending.push({ code: 'REMOTE_REVISION_RECHECK_REQUIRED', message: 'Reler os documentos oficiais e confirmar a revisão antes de importar ou sincronizar; revisões salvas podem anteceder correções auditadas.' });
        const record = createTrainingRecord({ topic, bank, sections, auditSchema, pending, documentRevisionId: revisions.get(topic.texto_id), questionRevisionId: revisions.get(topic.banco_id), auditRevisionId: revisions.get(topic.auditoria_id) });
        record.hashes = { sectionsSha256: sha256(JSON.stringify(sections)), bankSha256: sha256(JSON.stringify(bank)), auditSchemaSha256: auditSchema ? sha256(JSON.stringify(record.auditSchema)) : null };
        trainings.push(record);
      } catch (error) { diagnostics.push({ documentId: topic.texto_id, questionDocumentId: topic.banco_id, error: error.message }); }
    }
    const questionCount = trainings.reduce((n, t) => n + t.bank.length, 0);
    if (trainings.length !== status.topics.length) diagnostics.push({ error: `Topic count mismatch: expected ${status.topics.length}, prepared ${trainings.length}` });
    if (questionCount !== status.questions_unique) diagnostics.push({ error: `Question count mismatch: expected ${status.questions_unique}, prepared ${questionCount}` });
    if (usedSchemas.size !== status.audit_models || usedSchemas.size !== schemas.length) diagnostics.push({ error: `Audit count mismatch: inventory ${status.audit_models}, source ${schemas.length}, prepared ${usedSchemas.size}` });
    if (diagnostics.length) throw new Error(`Strict preparation failed with ${diagnostics.length} diagnostic(s)`);
    if (new Set(trainings.map(t => t.trainingId)).size !== trainings.length) throw new Error('Duplicate stable training IDs');
    const manifest = { schemaVersion: 1, projectId: 'sahmt-gestao-5ae66', trainings };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const stats = {
      trainings: trainings.length,
      questions: questionCount,
      selectedQuestions: trainings.length * 5,
      auditSchemas: usedSchemas.size,
      sections: trainings.reduce((n, t) => n + t.sections.length, 0),
      embeddedUniqueImages: assetHashes.size,
      imageOccurrences: trainings.reduce((n, t) => n + t.sections.reduce((m, s) => m + (s.html.match(/<img\b/g) || []).length, 0), 0),
      generalTrainings: trainings.filter(t => t.training.audienceGroup === 'GENERAL').length,
      restrictedTrainings: trainings.filter(t => t.training.audienceGroup === 'RESTRICTED').length,
      draftTrainings: trainings.length,
      sourceRevisions: {
        document: trainings.filter(t => t.training.source.documentRevisionId).length,
        question: trainings.filter(t => t.training.source.questionRevisionId).length,
        audit: trainings.filter(t => t.training.source.auditRevisionId).length,
      },
      pendingSourceReviews: trainings.filter(t => t.pending.some(p => p.code === 'SOURCE_REVIEW_REQUIRED')).length,
      firestoreImported: false,
      remoteWrites: false,
    };
    const hashes = { algorithm: 'SHA-256', manifestSha256: sha256(manifestText), sources: Object.fromEntries([...sourceHashes, ...assetHashes].sort(([a], [b]) => a.localeCompare(b))), trainingHashes: Object.fromEntries(trainings.map(t => [t.trainingId, t.hashes])) };
    await fs.writeFile(path.join(output, 'manifest.private.json'), manifestText);
    await fs.writeFile(path.join(output, 'sha256.private.json'), `${JSON.stringify(hashes, null, 2)}\n`);
    await fs.writeFile(path.join(output, 'summary.private.json'), `${JSON.stringify(stats, null, 2)}\n`);
    await fs.writeFile(path.join(output, 'diagnostics.private.json'), `${JSON.stringify({ strict: true, errors: [] }, null, 2)}\n`);
    return { output, ...stats, manifestSha256: hashes.manifestSha256 };
  } catch (error) {
    for (const name of ['manifest.private.json', 'sha256.private.json', 'summary.private.json']) await fs.rm(path.join(output, name), { force: true });
    if (!diagnostics.length) diagnostics.push({ error: error.message });
    await fs.writeFile(path.join(output, 'diagnostics.private.json'), `${JSON.stringify({ strict: true, errors: diagnostics }, null, 2)}\n`);
    throw error;
  }
}

export async function verifyPreparedHtmlTrainings({ workspaceRoot = process.cwd() } = {}) {
  const workspace = await fs.realpath(workspaceRoot);
  const output = path.join(workspace, '.local-preview/html-training-import');
  assertPrivateOutput(workspace, output);
  const auditRoot = await fs.realpath(path.join(workspace, '.local-preview/materials-audit-2026-10-25'));
  const data = await fs.readFile(path.join(output, 'manifest.private.json'));
  const hashes = JSON.parse(await fs.readFile(path.join(output, 'sha256.private.json'), 'utf8'));
  if (sha256(data) !== hashes.manifestSha256) throw new Error('Manifest SHA-256 mismatch');
  const manifest = JSON.parse(data);
  for (const [relative, expected] of Object.entries(hashes.sources)) {
    const file = await fs.realpath(path.resolve(auditRoot, relative));
    const rel = path.relative(auditRoot, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Hash source escapes private audit scope');
    const bytes = await fs.readFile(file);
    if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw new Error(`Source SHA-256 mismatch: ${relative}`);
  }
  for (const record of manifest.trainings) {
    const expected = hashes.trainingHashes[record.trainingId];
    if (!expected || expected.sectionsSha256 !== sha256(JSON.stringify(record.sections)) || expected.bankSha256 !== sha256(JSON.stringify(record.bank)) || expected.auditSchemaSha256 !== (record.auditSchema ? sha256(JSON.stringify(record.auditSchema)) : null)) throw new Error(`Training SHA-256 mismatch: ${record.trainingId}`);
  }
  return { verified: true, trainings: manifest.trainings.length, sources: Object.keys(hashes.sources).length, manifestSha256: hashes.manifestSha256 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2); let workspaceRoot = process.cwd(); let verify = false;
    while (args.length) {
      const arg = args.shift();
      if (arg === '--workspace' && args[0]) workspaceRoot = path.resolve(args.shift());
      else if (arg === '--verify') verify = true;
      else throw new Error('Usage: node scripts/prepare-html-trainings.mjs [--workspace PATH] [--verify]');
    }
    // Prevent accidental publication of content through an unignored output folder.
    const ignored = spawnSync('git', ['check-ignore', '-q', '.local-preview/html-training-import/manifest.private.json'], { cwd: workspaceRoot, stdio: 'ignore' });
    const gitRoot = await fs.stat(path.join(workspaceRoot, '.git')).catch(() => null);
    if (gitRoot && ignored.status !== 0) throw new Error('Private output is not ignored by Git; preparation refused');
    console.log(JSON.stringify(await (verify ? verifyPreparedHtmlTrainings({ workspaceRoot }) : prepareHtmlTrainings({ workspaceRoot })), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
