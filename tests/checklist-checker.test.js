import test from 'node:test';
import assert from 'node:assert/strict';
import {CHECKLIST_NONCONFORMING_COMMITMENT, shortChecklistCheckerName, checklistCheckerDateTime, checklistCheckerSummary} from '../src/checklist-checker.js';

const iso = '2026-10-01T15:25:00.000Z';
const serverRecord = {condition: 'SIM', createdByUid: 'checker-A', createdByName: '  Mariana  Pereira Costa  ', createdAt: iso};

test('nome resumido preserva grafia e usa primeiro e último nome', () => {
  assert.equal(shortChecklistCheckerName('  Luís   Antônio de Souza '), 'Luís Souza');
  assert.equal(shortChecklistCheckerName('Ana'), 'Ana');
  assert.equal(shortChecklistCheckerName('Maria Clara'), 'Maria Clara');
  assert.equal(shortChecklistCheckerName('   '), '');
});

test('data e hora usam São Paulo com ISO, Date e Timestamp do servidor', () => {
  for (const value of [iso, new Date(iso), {toDate: () => new Date(iso)}]) assert.match(checklistCheckerDateTime(value), /01\/10\/2026.*12:25/);
});

test('Timestamp clonado pelo cache continua mostrando a data e hora corretas', () => {
  const seconds = new Date(iso).getTime() / 1000;
  for (const value of [{seconds, nanoseconds: 0}, {_seconds: seconds, _nanoseconds: 0}]) assert.match(checklistCheckerDateTime(value), /01\/10\/2026.*12:25/);
});

test('metadados de tempo ausentes ou inválidos não viram uma data inventada', () => {
  for (const value of [undefined, null, '', false, 'data inválida', {}, {seconds: 2, nanoseconds: -1}, {seconds: Infinity}, {toDate: () => {throw new Error('invalid');}}]) assert.equal(checklistCheckerDateTime(value), '');
});

test('quem checou é o autor do registro, não o responsável pela assinatura', () => {
  const result = checklistCheckerSummary({...serverRecord, responsibleName: 'Outro Responsável', responsibleUid: 'scheduled'}, {uid: 'reader', profileName: 'Nome do leitor'});
  assert.equal(result.name, 'Mariana Costa'); assert.equal(result.creatorUid, 'checker-A'); assert.equal(result.pending, false);
});

test('registro legado usa o perfil atual somente para o mesmo UID', () => {
  const record = {createdByUid: 'checker-A', createdAt: iso};
  assert.equal(checklistCheckerSummary(record, {uid: 'checker-A', profileName: 'Carlos Pereira Santos'}).name, 'Carlos Santos');
  assert.equal(checklistCheckerSummary(record, {uid: 'reader', profileName: 'Carlos Pereira Santos'}).name, '');
  assert.equal(checklistCheckerSummary({responsibleUid: 'reader', responsibleName: 'Responsável de assinatura'}, {uid: 'reader', profileName: 'Carlos Pereira Santos'}).name, '');
});

test('pendência local identifica o autor da partição e não confirma nome ou hora do servidor', () => {
  const result = checklistCheckerSummary({...serverRecord, pendingSync: true, createdByName: 'Nome local não validado'}, {uid: 'checker-A', profileName: 'Carlos Pereira Santos'});
  assert.equal(result.name, 'Carlos Santos'); assert.equal(result.pending, true); assert.equal(result.failed, false);
  const failed = checklistCheckerSummary({...serverRecord, syncFailed: true}, {uid: 'reader'});
  assert.equal(failed.name, ''); assert.equal(failed.pending, true); assert.equal(failed.failed, true);
});

test('banner sem checagem não apresenta autoria inexistente e declaração é literal', () => {
  assert.equal(checklistCheckerSummary(null), null);
  assert.equal(CHECKLIST_NONCONFORMING_COMMITMENT, 'Me comprometo a comunicar imediatamente à equipe e ao setor responsável pela manutenção.');
});
test('leitura QR entrega o registro ao banner completo com origem validada', async () => {
  const {readFileSync} = await import('node:fs');
  const vm = await import('node:vm');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function revealChecklistStation(');
  const end = main.indexOf('function ensureChecklistDailyReportOpen(', start);
  const calls = [], record = {...serverRecord}, station = {id: 'arsenal-ficticio'};
  const context = vm.createContext({checklistReportContext: {day: '2026-10-01', latestByStation: new Map([[station.id, record]]), priorByStation: new Map()},
    resolveChecklistDayRecord: (_station, latest) => latest, todayInputValue: () => '2026-10-01',
    showChecklistStationBanner: (...args) => calls.push(args)});
  vm.runInContext(main.slice(start, end), context);
  context.revealChecklistStation(station, '2026-10-01', [station]);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], station); assert.equal(calls[0][1], record);
  assert.equal(calls[0][4].fromQr, true);
  const scanner = main.slice(main.indexOf('async function openChecklistQrScanner('), main.indexOf('async function loadMonthlyChecklist('));
  assert.match(scanner, /if \(dialog\.open\) dialog\.close\(\);[\s\S]*revealChecklistStation\(station, day, stations\)/);
});