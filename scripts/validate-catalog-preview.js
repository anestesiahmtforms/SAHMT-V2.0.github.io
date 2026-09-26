import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(scriptDirectory, '../.local-preview/catalog-import-preview.json');
const previewPath = path.resolve(process.argv[2] || defaultPath);
const errors = [];
let manualCheckCount = 0;
let verifiedCheckCount = 0;
const fail = (message) => errors.push(message);
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const validateManualChecks = (entry, prefix) => {
  if (!Array.isArray(entry?.manualChecks) || entry.manualChecks.length === 0) {
    fail(`${prefix}.manualChecks precisa conter ao menos uma conferência pendente.`);
    return;
  }
  manualCheckCount += entry.manualChecks.length;
  if (entry.manualChecks.some((check) => !nonEmptyString(check))) fail(`${prefix}.manualChecks contém uma conferência vazia.`);
  if (entry.verifiedChecks !== undefined) {
    if (!Array.isArray(entry.verifiedChecks) || entry.verifiedChecks.some((check) => !nonEmptyString(check))) {
      fail(`${prefix}.verifiedChecks precisa ser uma lista de conferências concluídas não vazias.`);
    } else {
      verifiedCheckCount += entry.verifiedChecks.length;
    }
  }
};
const validDay = (value) => {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validSigla = (value) => typeof value === 'string' && /^(?:DC|L2|[A-Z]{2})(?:[/-](?:DC|L2|[A-Z]{2}))*$/.test(value);
const validEventHighlight = (value) => value === 'SUPORTE' || validSigla(value);

let preview;
try {
  preview = JSON.parse(await readFile(previewPath, 'utf8'));
} catch (error) {
  console.error(`Não foi possível abrir o preview: ${error.message}`);
  process.exitCode = 1;
}

if (preview) {
  if (preview.previewOnly !== true) fail('O documento precisa declarar previewOnly=true.');
  if (preview.writeEnabled !== false) fail('O preview deve manter writeEnabled=false.');
  if (preview.targetDatabase !== 'sahmt-17a16/(default)') fail('O destino precisa ser sahmt-17a16/(default).');
  if (!validDay(preview.generatedAt)) fail('generatedAt precisa ser uma data ISO válida.');
  if (!Array.isArray(preview.globalManualChecks) || preview.globalManualChecks.length === 0 || preview.globalManualChecks.some((check) => !nonEmptyString(check))) fail('Inclua as conferências manuais globais como instruções não vazias.');
  const sourceRevalidation = preview.source?.revalidation;
  if (sourceRevalidation !== undefined) {
    if (!validDay(sourceRevalidation.checkedAt)) fail('source.revalidation.checkedAt precisa ser uma data ISO válida.');
    if (!nonEmptyString(sourceRevalidation.sourceModifiedTime) || !Number.isFinite(Date.parse(sourceRevalidation.sourceModifiedTime))) fail('source.revalidation.sourceModifiedTime precisa ser uma data válida.');
    for (const name of ['stations', 'scheduleDays', 'vacations']) {
      const result = sourceRevalidation[name];
      const expectedRows = name === 'stations' ? preview.stations?.length : name === 'scheduleDays' ? preview.scheduleDays?.length : preview.vacations?.length;
      if (!result || !nonEmptyString(result.range) || result.sourceRows !== expectedRows || result.previewRows !== expectedRows || result.exactMatches !== expectedRows || result.differences !== 0) {
        fail(`source.revalidation.${name} não confirma correspondência integral com o preview.`);
      }
    }
  }

  for (const [name, entries] of [['stations', preview.stations], ['trainings', preview.trainings]]) {
    if (!Array.isArray(entries)) {
      fail(`${name} precisa ser uma lista.`);
      continue;
    }
    if (preview.summary?.[name]?.total !== entries.length) fail(`A contagem summary.${name}.total não corresponde à lista.`);
    const ids = new Set();
    const orders = new Set();
    for (const [index, entry] of entries.entries()) {
      const candidate = entry?.candidate;
      const prefix = `${name}[${index + 1}]`;
      if (!candidate || typeof candidate !== 'object') {
        fail(`${prefix} não contém candidate.`);
        continue;
      }
      const expectedCollection = name === 'stations' ? 'stations' : 'trainings';
      if (candidate.collection !== expectedCollection) fail(`${prefix}.candidate.collection deve ser ${expectedCollection}.`);
      if (!nonEmptyString(candidate.id) || candidate.documentId !== candidate.id) fail(`${prefix} precisa manter id e documentId iguais e não vazios.`);
      if (nonEmptyString(candidate.id)) {
        if (candidate.id.includes('/')) fail(`${prefix}.candidate.id não pode conter barra.`);
        if (ids.has(candidate.id)) fail(`${prefix}.candidate.id está duplicado.`);
        ids.add(candidate.id);
      }
      if (typeof candidate.active !== 'boolean') fail(`${prefix}.candidate.active precisa ser boolean.`);
      if (!Number.isInteger(candidate.order) || candidate.order < 0) fail(`${prefix}.candidate.order precisa ser inteiro não negativo.`);
      else if (orders.has(candidate.order)) fail(`${prefix}.candidate.order está duplicado.`);
      else orders.add(candidate.order);
      if (!Number.isInteger(candidate.version) || candidate.version < 1) fail(`${prefix}.candidate.version precisa ser inteiro positivo.`);
      if (!Array.isArray(entry.sourceIssues) || entry.sourceIssues.length > 0) fail(`${prefix} tem issue de origem ou sourceIssues inválido.`);
      validateManualChecks(entry, prefix);

      if (name === 'stations') {
        if (!nonEmptyString(candidate.name) || candidate.name.length > 120) fail(`${prefix}.candidate.name precisa ter de 1 a 120 caracteres.`);
        if (!nonEmptyString(candidate.qrCode) || candidate.qrCode.trim().length > 200) fail(`${prefix}.candidate.qrCode precisa ter de 1 a 200 caracteres.`);
        if (!validDay(candidate.start) || !validDay(candidate.end)) fail(`${prefix} contém data de vigência inválida.`);
        if (candidate.start && candidate.end && candidate.start > candidate.end) fail(`${prefix} tem início posterior ao fim da vigência.`);
      } else {
        if (!nonEmptyString(candidate.title) || candidate.title.length > 160) fail(`${prefix}.candidate.title precisa ter de 1 a 160 caracteres.`);
        if (!nonEmptyString(candidate.videoId) || !nonEmptyString(candidate.videoUrl)) fail(`${prefix} precisa de videoId e videoUrl.`);
        try {
          const url = new URL(candidate.videoUrl);
          if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
            fail(`${prefix}.candidate.videoUrl não usa um host HTTPS de YouTube permitido.`);
          }
        } catch {
          fail(`${prefix}.candidate.videoUrl não é uma URL válida.`);
        }
        if (typeof candidate.accessPoints !== 'number' || candidate.accessPoints < 0) fail(`${prefix}.candidate.accessPoints precisa ser número não negativo.`);
        if (typeof candidate.completionPoints !== 'number' || candidate.completionPoints < 0) fail(`${prefix}.candidate.completionPoints precisa ser número não negativo.`);
      }
    }
  }

  const scheduleDays = preview.scheduleDays;
  if (!Array.isArray(scheduleDays)) fail('scheduleDays precisa ser uma lista.');
  else {
    if (preview.summary?.scheduleDays?.total !== scheduleDays.length) fail('A contagem summary.scheduleDays.total não corresponde à lista.');
    const dates = new Set();
    const positionCounts = {};
    let dcDays = 0;
    let markedSiglas = 0;
    let markedEvents = 0;
    for (const [index, entry] of scheduleDays.entries()) {
      const candidate = entry?.candidate;
      const prefix = `scheduleDays[${index + 1}]`;
      if (!candidate || typeof candidate !== 'object') { fail(`${prefix} não contém candidate.`); continue; }
      if (candidate.collection !== 'scheduleDays') fail(`${prefix}.candidate.collection deve ser scheduleDays.`);
      if (!validDay(candidate.date) || !nonEmptyString(candidate.date)) fail(`${prefix}.candidate.date precisa ser data ISO válida.`);
      if (candidate.id !== candidate.date || candidate.documentId !== candidate.date) fail(`${prefix} deve usar a data ISO como ID estável.`);
      if (dates.has(candidate.date)) fail(`${prefix}.candidate.date está duplicada.`);
      dates.add(candidate.date);
      if (!Number.isInteger(candidate.version) || candidate.version < 1) fail(`${prefix}.candidate.version precisa ser inteiro positivo.`);
      if (!Array.isArray(candidate.positions) || candidate.positions.length < 1 || candidate.positions.length > 17) fail(`${prefix}.candidate.positions precisa conter de 1 a 17 posições.`);
      else {
        positionCounts[candidate.positions.length] = (positionCounts[candidate.positions.length] || 0) + 1;
        let previousPosition = 0;
        let dayHasDc = false;
        for (const position of candidate.positions) {
          if (!Number.isInteger(position?.position) || position.position < 1 || position.position > 17 || position.position <= previousPosition) fail(`${prefix}.candidate.positions deve preservar posições únicas em ordem crescente.`);
          previousPosition = position?.position;
          if (!validSigla(position?.sigla)) fail(`${prefix}.candidate.positions contém sigla inválida.`);
          if (String(position?.sigla || '').split(/[/-]/).includes('DC')) dayHasDc = true;
        }
        if (dayHasDc) dcDays++;
      }
      const highlights = candidate.highlights;
      if (!highlights || !Array.isArray(highlights.siglas) || !Array.isArray(highlights.events)) fail(`${prefix}.candidate.highlights precisa separar siglas e eventos.`);
      else {
        if (highlights.siglas.some((sigla) => !validSigla(sigla))) fail(`${prefix}.candidate.highlights.siglas contém valor inválido.`);
        if (highlights.events.some((sigla) => !validEventHighlight(sigla))) fail(`${prefix}.candidate.highlights.events contém valor inválido.`);
        if (new Set(highlights.siglas).size !== highlights.siglas.length || new Set(highlights.events).size !== highlights.events.length) fail(`${prefix}.candidate.highlights contém duplicatas.`);
        markedSiglas += highlights.siglas.length;
        markedEvents += highlights.events.length;
      }
      if (!Array.isArray(entry.sourceIssues) || entry.sourceIssues.length > 0) fail(`${prefix} tem issue de origem ou sourceIssues inválido.`);
      validateManualChecks(entry, prefix);
    }
    const sortedDates = [...dates].sort();
    if (preview.summary?.scheduleDays?.firstDate !== sortedDates[0] || preview.summary?.scheduleDays?.lastDate !== sortedDates.at(-1)) fail('O intervalo de datas no resumo da escala não corresponde à lista.');
    if (JSON.stringify(preview.summary?.scheduleDays?.positionsPerDay) !== JSON.stringify(positionCounts)) fail('A distribuição de posições no resumo não corresponde à lista.');
    if (preview.summary?.scheduleDays?.daysWithDc !== dcDays) fail('A contagem de dias com DC no resumo não corresponde à lista.');
    if (preview.summary?.scheduleDays?.markedSiglas !== markedSiglas || preview.summary?.scheduleDays?.markedEvents !== markedEvents) fail('As contagens de destaques no resumo não correspondem à lista.');
  }

  const vacations = preview.vacations;
  if (!Array.isArray(vacations)) fail('vacations precisa ser uma lista.');
  else {
    if (preview.summary?.vacations?.total !== vacations.length) fail('A contagem summary.vacations.total não corresponde à lista.');
    const ids = new Set();
    let withoutSiglas = 0;
    for (const [index, entry] of vacations.entries()) {
      const candidate = entry?.candidate;
      const prefix = `vacations[${index + 1}]`;
      if (!candidate || typeof candidate !== 'object') { fail(`${prefix} não contém candidate.`); continue; }
      if (candidate.collection !== 'vacations') fail(`${prefix}.candidate.collection deve ser vacations.`);
      if (!nonEmptyString(candidate.id) || candidate.documentId !== candidate.id || candidate.id.includes('/')) fail(`${prefix} precisa de ID estável sem barra.`);
      if (ids.has(candidate.id)) fail(`${prefix}.candidate.id está duplicado.`);
      ids.add(candidate.id);
      if (!validDay(candidate.start) || !nonEmptyString(candidate.start) || !validDay(candidate.end) || !nonEmptyString(candidate.end) || candidate.start > candidate.end) fail(`${prefix} contém período de férias inválido.`);
      if (!Array.isArray(candidate.siglas) || candidate.siglas.length > 30 || candidate.siglas.some((sigla) => !validSigla(sigla))) fail(`${prefix}.candidate.siglas precisa ser uma lista válida de até 30 siglas.`);
      if (Array.isArray(candidate.siglas) && candidate.siglas.length === 0) withoutSiglas++;
      if (!nonEmptyString(candidate.label) || candidate.label.length > 240) fail(`${prefix}.candidate.label precisa ter de 1 a 240 caracteres.`);
      if (typeof candidate.notes !== 'string' || candidate.notes.length > 1000) fail(`${prefix}.candidate.notes precisa ser texto de até 1000 caracteres.`);
      if (candidate.active !== true) fail(`${prefix}.candidate.active precisa manter o registro de férias da fonte ativo.`);
      if (!Number.isInteger(candidate.version) || candidate.version < 1) fail(`${prefix}.candidate.version precisa ser inteiro positivo.`);
      if (!Array.isArray(entry.sourceIssues) || entry.sourceIssues.length > 0) fail(`${prefix} tem issue de origem ou sourceIssues inválido.`);
      validateManualChecks(entry, prefix);
    }
    if (preview.summary?.vacations?.withoutExplicitSiglas !== withoutSiglas) fail('A contagem de férias sem siglas explícitas no resumo não corresponde à lista.');
  }

  if (Array.isArray(preview.stations)) {
    const activeQr = new Map();
    for (const [index, entry] of preview.stations.entries()) {
      const candidate = entry?.candidate;
      if (candidate?.active !== true || !nonEmptyString(candidate.qrCode)) continue;
      const qr = candidate.qrCode.trim().toUpperCase();
      if (activeQr.has(qr)) fail(`QR ativo duplicado entre estações ${activeQr.get(qr)} e ${index + 1}.`);
      else activeQr.set(qr, index + 1);
    }
    const activeCount = preview.stations.filter((entry) => entry?.candidate?.active === true).length;
    const inactiveCount = preview.stations.filter((entry) => entry?.candidate?.active === false).length;
    if (preview.summary?.stations?.activeCandidates !== activeCount) fail('A contagem de estações ativas no resumo não corresponde à lista.');
    if (preview.summary?.stations?.inactiveCandidates !== inactiveCount) fail('A contagem de estações inativas no resumo não corresponde à lista.');
    if (preview.summary?.stations?.duplicateActiveQrGroups !== 0) fail('O resumo registra QR ativo duplicado.');
  }

  if (errors.length) {
    console.error(`Preview recusado (${errors.length} problema(s)); nenhuma gravação foi feita:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Preview válido: ${preview.stations.length} estações, ${preview.trainings.length} treinamentos, ${preview.scheduleDays.length} dias de escala e ${preview.vacations.length} períodos de férias.`);
    console.log(`Destino declarado: sahmt-17a16/(default). Modo somente leitura: nenhuma gravação foi feita. ${verifiedCheckCount} conferências por registro concluídas; ${manualCheckCount} por registro e ${preview.globalManualChecks.length} globais continuam pendentes.`);
    if (sourceRevalidation) console.log(`Fonte revalidada em ${sourceRevalidation.checkedAt}: estações, escala e férias correspondem integralmente nos intervalos conferidos; nenhuma gravação foi feita.`);
  }
}
