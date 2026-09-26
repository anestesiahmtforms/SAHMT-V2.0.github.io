import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script-v2/SheetsSync.gs', import.meta.url), 'utf8');
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

