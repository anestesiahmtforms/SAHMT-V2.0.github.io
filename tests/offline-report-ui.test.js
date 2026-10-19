import test from 'node:test';
import assert from 'node:assert/strict';
import {bindOfflineOperationalReports, createOfflineReportView} from '../src/offline-report-ui.js';

test('offline daily report presents only cached event records', () => {
  const view = createOfflineReportView({
    kind: 'events',
    period: 'daily',
    day: '2026-10-19',
    records: [{memberStatus: 'ESCALADO', eventType: 'ATRASO', description: 'Registro local'}],
    hasSnapshot: true
  });
  assert.equal(view.available, true);
  assert.match(view.message, /ESCALADO/);
  assert.match(view.message, /ATRASO/);
  assert.match(view.message, /Registro local/);
});

test('offline monthly report explains that monthly cache is not available', () => {
  const view = createOfflineReportView({kind: 'events', period: 'monthly', records: []});
  assert.equal(view.available, false);
  assert.match(view.message, /mensal/i);
  assert.match(view.message, /conecte-se/i);
});

test('offline daily report explains when no local snapshot exists', () => {
  const view = createOfflineReportView({kind: 'labels', period: 'daily', records: []});
  assert.equal(view.available, false);
  assert.match(view.message, /cópia/i);
  assert.match(view.message, /aparelho/i);
});

test('offline report launcher opens from local records without requiring a network callback', () => {
  const elements = new Map();
  const makeElement = () => ({
    hidden: true,
    textContent: '',
    listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    showModal() { this.open = true; },
    querySelector(selector) { return elements.get(selector); }
  });
  const dialog = makeElement();
  const title = makeElement();
  const status = makeElement();
  const results = makeElement();
  elements.set('#event-report-dialog-title', title);
  elements.set('#event-report-sync', status);
  elements.set('#event-report-results', results);
  elements.set('#event-day-control', makeElement());
  elements.set('#event-month-control', makeElement());
  const launcher = makeElement();
  launcher.dataset = {eventReportLaunch: 'daily'};
  const root = {
    querySelector: () => dialog,
    querySelectorAll: () => [launcher]
  };
  const bound = bindOfflineOperationalReports({
    root,
    kind: 'events',
    day: '2026-10-19',
    snapshot: {records: [{eventType: 'ATRASO'}]}
  });
  launcher.listeners.click();
  assert.equal(bound, 1);
  assert.equal(launcher.disabled, false);
  assert.equal(dialog.open, true);
  assert.match(results.textContent, /ATRASO/);
  assert.match(status.textContent, /SEM ACESSO AO FIRESTORE/);
});
