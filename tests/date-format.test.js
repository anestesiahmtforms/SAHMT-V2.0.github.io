import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {formatDisplayDate, formatDisplayDateTime} from '../src/date-format.js';
import {fgPerformanceMarkup} from '../src/fg-performance-ui.js';
import {createOfflineReportView} from '../src/offline-report-ui.js';

test('calendar keys retain the selected day and validate leap dates', () => {
  assert.equal(formatDisplayDate('2026-11-15'), '15/11/2026');
  assert.equal(formatDisplayDateTime('2026-11-15'), '15/11/2026');
  assert.equal(formatDisplayDate('2028-02-29'), '29/02/2028');
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01']) {
    assert.equal(formatDisplayDate(invalid, {fallback:'Indisponível'}), 'Indisponível');
  }
});

test('instants and Firestore timestamps use Sao Paulo with four digit years', () => {
  const date = new Date('2027-01-01T01:04:05Z');
  const milliseconds = date.getTime();
  for (const value of [date, milliseconds, date.toISOString(), {toDate:()=>date}, {toMillis:()=>milliseconds}, {seconds:milliseconds/1000}, {_seconds:milliseconds/1000}]) {
    assert.equal(formatDisplayDate(value), '31/12/2026');
    assert.equal(formatDisplayDateTime(value), '31/12/2026, 22:04');
    assert.equal(formatDisplayDateTime(value, {seconds:true}), '31/12/2026, 22:04:05');
  }
});

test('missing, invalid, and broken timestamps use the caller fallback', () => {
  for (const value of [null, undefined, '', true, false, 'invalid', {}, new Date(NaN), NaN, Infinity, {seconds:NaN}, {seconds:0,nanoseconds:1e9}, {toDate:()=>{throw Error('broken');}}]) {
    assert.equal(formatDisplayDate(value), '');
    assert.equal(formatDisplayDateTime(value, {fallback:'Não registrado'}), 'Não registrado');
  }
  assert.equal(formatDisplayDateTime(0), '31/12/1969, 21:00');
});

test('display does not depend on the device timezone', () => {
  const helper = new URL('../src/date-format.js', import.meta.url).href;
  const code = 'import {formatDisplayDate,formatDisplayDateTime} from '+JSON.stringify(helper)+';process.stdout.write(JSON.stringify([formatDisplayDate("2026-11-15"),formatDisplayDateTime("2027-01-01T01:04:05Z"),formatDisplayDate("04/10/2026"),formatDisplayDateTime("04/10/2026 00:01:02.123",{seconds:true})]));';
  for (const TZ of ['Pacific/Auckland', 'America/Los_Angeles']) {
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {env:{...process.env,TZ},encoding:'utf8'})), ['15/11/2026','31/12/2026, 22:04','04/10/2026','04/10/2026, 00:01:02']);
  }
});

test('FG ledger and offline reports display calendar dates without changing their data', () => {
  const data = {team:[{uid:'self',displayName:'Pessoa'}],summary:{uid:'self',total:1},effectiveFrom:'2027-01-01T01:04:05Z',ledger:[{day:'2026-11-15',delta:1,reason:'ACKNOWLEDGEMENT'}]};
  const markup = fgPerformanceMarkup(data);
  assert.match(markup, /<td>15\/11\/2026<\/td>/);
  assert.match(markup, /31\/12\/2026, 22:04/);
  assert.doesNotMatch(markup, /2026-11-15/);
  assert.equal(data.ledger[0].day,'2026-11-15');
  const record = {memberStatus:'ESCALADO',date:'2026-11-15'};
  const view = createOfflineReportView({kind:'events',period:'daily',day:'2026-11-15',records:[record],hasSnapshot:true});
  assert.match(view.message, /Cópia local de 15\/11\/2026/);
  assert.match(view.message, /ESCALADO · 15\/11\/2026/);
  assert.equal(record.date,'2026-11-15');
});


test('legacy Brazilian dates never use ambiguous US month/day parsing', () => {
  assert.equal(formatDisplayDate('04/10/2026'), '04/10/2026');
  assert.equal(formatDisplayDateTime('04/10/2026'), '04/10/2026');
  assert.equal(formatDisplayDate('15/11/2026'), '15/11/2026');
  assert.equal(formatDisplayDate('29/02/2028'), '29/02/2028');
  assert.equal(formatDisplayDate('04/10/2026 00:01:02.123'), '04/10/2026');
  assert.equal(formatDisplayDateTime('04/10/2026 00:01'), '04/10/2026, 00:01');
  assert.equal(formatDisplayDateTime('04/10/2026 23:59:58.123', {seconds:true}), '04/10/2026, 23:59:58');
  assert.equal(formatDisplayDateTime('04/10/2026 23:59', {seconds:true}), '04/10/2026, 23:59:00');
  assert.equal(formatDisplayDateTime('04/10/2026, 23:59:58'), '04/10/2026, 23:59');
  for (const value of ['29/02/2026','31/04/2026','04/13/2026','04/10/2026 24:00','04/10/2026 12:60','04/10/2026 12:01:60','04/10/2026 12:01:01.1234','4/10/2026','10/4/2026']) {
    assert.equal(formatDisplayDate(value, {fallback:'Inválida'}), 'Inválida', value);
    assert.equal(formatDisplayDateTime(value, {fallback:'Inválida'}), 'Inválida', value);
  }
});
