import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script-v2/ReportsSetup.gs', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);

function formatsFor(fields) {
  const formats = new Map();
  const sheet = {
    getMaxRows: () => 100,
    getRange(row, column) {
      return {setNumberFormat(format) { formats.set(fields[column - 1], format); }};
    }
  };
  context.applyReportColumnFormats_(sheet, {fields});
  return formats;
}

test('Apps Script keeps decimal precision in measurements, durations, progress, and points', () => {
  const fields = ['value', 'lastPosition', 'duration', 'watchedPercent', 'points', 'pointsGenerated', 'completionPoints'];
  const formats = formatsFor(fields);
  for (const field of fields) assert.equal(formats.get(field), '0.############', field);
});

test('Apps Script preserves integer display for counters and versions', () => {
  const fields = ['delayMultiple', 'version', 'ruleVersion'];
  const formats = formatsFor(fields);
  for (const field of fields) assert.equal(formats.get(field), '0', field);
});

test('Apps Script date columns display day/month/year while timestamp cells retain time', () => {
  const formats = formatsFor(['date', 'createdAt', 'dueAt', 'uid']);
  assert.equal(formats.get('date'), 'dd/mm/yyyy');
  assert.equal(formats.get('createdAt'), 'dd/mm/yyyy hh:mm:ss');
  assert.equal(formats.get('dueAt'), 'dd/mm/yyyy hh:mm:ss');
  assert.equal(formats.get('uid'), '@');
});

test('legacy report projection converts date-only strings to native dates without changing identifiers', () => {
  const calls = [];
  const ctx = vm.createContext({Utilities:{parseDate:(...args)=>{calls.push(args);return new Date('2026-11-15T03:00:00Z');}}});
  vm.runInContext(readFileSync(new URL('../apps-script-v2/SparkReportSync.gs', import.meta.url), 'utf8'), ctx);
  const row = ctx.reportValuesForSpark_({fields:['date','idRegistro','description']}, {resourceType:'events',resourceId:'2026-11-15'}, {date:'2026-11-15',description:'=1+1'});
  assert.equal(row[0].toISOString(), '2026-11-15T03:00:00.000Z');
  assert.deepEqual(calls, [['2026-11-15', 'America/Sao_Paulo', 'yyyy-MM-dd']]);
  assert.equal(row[1], '2026-11-15');
  assert.equal(row[2], "'=1+1");
});
