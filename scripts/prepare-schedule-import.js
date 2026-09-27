import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewPath = path.resolve(process.argv[2] || path.join(root, '.local-preview/catalog-import-preview.json'));
const decisionsPath = path.resolve(process.argv[3] || path.join(root, '.local-preview/catalog-review-decisions.json'));
const manifestPath = path.resolve(process.argv[4] || path.join(root, '.local-preview/schedule-import-manifest.json'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const siglaPattern = /^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/;

function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

function fail(message) { throw new Error(message); }

async function prepare() {
  const [previewRaw, decisionsRaw] = await Promise.all([
    readFile(previewPath, 'utf8'),
    readFile(decisionsPath, 'utf8').catch(() => fail('Falta catalog-review-decisions.json. Exporte as decisões na ferramenta de revisão e informe o caminho do arquivo.'))
  ]);
  const preview = JSON.parse(previewRaw);
  const decisions = JSON.parse(decisionsRaw);
  if (preview.previewOnly !== true || preview.writeEnabled !== false || preview.targetDatabase !== 'sahmt-17a16/(default)') fail('Prévia ou destino incompatível.');
  if (decisions.schemaVersion !== 1 || decisions.previewFingerprint !== hash(previewRaw) ||
      decisions.previewGeneratedAt !== preview.generatedAt || decisions.targetDatabase !== preview.targetDatabase) {
    fail('As decisões não correspondem exatamente ao arquivo da prévia selecionado.');
  }
  const sourceCheck = preview.source?.revalidation?.scheduleDays;
  const entries = preview.scheduleDays;
  if (!Array.isArray(entries) || entries.length !== 307 || sourceCheck?.exactMatches !== entries.length || sourceCheck?.differences !== 0) {
    fail('A prévia precisa confirmar os 307 dias com correspondência integral à fonte.');
  }
  const globalChecks = new Map((decisions.globalChecks || []).map((check) => [check.instruction, check.checked === true]));
  for (const index of [1, 2, 3, 4]) {
    const instruction = preview.globalManualChecks?.[index];
    if (!instruction || globalChecks.get(instruction) !== true) fail(`Conferência global ${index + 1} ainda não concluída.`);
  }
  const reviewByRow = new Map((decisions.recordChecks || []).filter((item) => item.category === 'scheduleDays').map((item) => [item.sourceRow, item]));
  if (reviewByRow.size !== entries.length) fail('A revisão não cobre todos os dias da escala.');
  const seenDates = new Set();
  const seenRows = new Set();
  const records = entries.map((entry) => {
    const {candidate, sourceRow} = entry;
    const review = reviewByRow.get(sourceRow);
    if (!Number.isInteger(sourceRow) || seenRows.has(sourceRow) || !review || !Array.isArray(entry.manualChecks) || entry.manualChecks.length === 0 ||
        !Array.isArray(review.unchecked) || review.unchecked.length ||
        !Array.isArray(review.checked) || entry.manualChecks.some((check) => !review.checked.includes(check))) {
      fail(`A linha ${sourceRow} ainda precisa de conferência completa.`);
    }
    seenRows.add(sourceRow);
    if (!validDay(candidate?.date) || candidate.documentId !== candidate.date || candidate.id !== candidate.date || seenDates.has(candidate.date)) {
      fail(`Data ou ID inválido na linha ${sourceRow}.`);
    }
    seenDates.add(candidate.date);
    if (entry.sourceIssues?.length || !Array.isArray(candidate.positions) || candidate.positions.length < 1 || candidate.positions.length > 30 ||
        candidate.positions.some((position, index) => position?.position !== index + 1 || typeof position.sigla !== 'string' || !siglaPattern.test(position.sigla) || position.sigla.length > 30)) {
      fail(`Posições inválidas na linha ${sourceRow}.`);
    }
    if (!Array.isArray(candidate.highlights?.siglas) || candidate.highlights.siglas.some((value) => typeof value !== 'string') ||
        !Array.isArray(candidate.highlights?.events) || candidate.highlights.events.some((value) => typeof value !== 'string') || candidate.version !== 1) {
      fail(`Destaques ou versão inválidos na linha ${sourceRow}.`);
    }
    return {sourceRow, id: candidate.id, date: candidate.date, positions: candidate.positions, highlights: candidate.highlights, version: 1};
  });
  records.sort((a, b) => a.date.localeCompare(b.date));
  const manifest = {
    schemaVersion: 1, writeEnabled: false, targetDatabase: preview.targetDatabase,
    previewFingerprint: hash(previewRaw), reviewFingerprint: hash(decisionsRaw),
    sourceModifiedTime: preview.source?.revalidation?.sourceModifiedTime || '',
    reviewedAt: decisions.exportedAt, preparedAt: new Date().toISOString(),
    count: records.length, firstDate: records[0].date, lastDate: records.at(-1).date,
    records
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
  console.log(`Manifesto local preparado: ${records.length} dias (${manifest.firstDate} a ${manifest.lastDate}). Nenhuma gravação no Firebase.`);
  console.log(`Arquivo: ${manifestPath}`);
}

prepare().catch((error) => { console.error(error.message); process.exitCode = 1; });
