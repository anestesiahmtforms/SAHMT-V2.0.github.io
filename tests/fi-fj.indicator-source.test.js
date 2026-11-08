import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndicatorSources} from '../worker-indicators/sources.js';

test('indicator event reads use the FI owner while preserving the stored activity identifier', async () => {
  const calls = [], budgets = [];
  const sources = createIndicatorSources({getAccessToken: async () => 'synthetic-service',
    readBudget: {reserve: async (project, count) => {budgets.push(project); return {project, count};}, settle: async () => {}},
    fetchImpl: async (url, options) => {calls.push(url); const query = JSON.parse(options.body).structuredQuery;
      assert.equal(query.from[0].collectionId, 'events'); assert.ok(query.where);
      return Response.json([{document: {name: 'projects/sahmt-operacional-fi/databases/(default)/documents/events/event', fields: {date: {stringValue: '2026-11-06'}, active: {booleanValue: true}}}}]);
    }});
  const value = await sources.load('operations', 2026, 'FA.events');
  assert.equal(calls.length, 1); assert.ok(calls[0].includes('/projects/sahmt-operacional-fi/'));
  assert.deepEqual(budgets, ['FI']); assert.equal(value.readsByProject.FI, 1);
  assert.equal(value.sources.FA.events.status, 'ok'); assert.equal(value.sources.FA.events.rows[0].date, '2026-11-06');
});

test('FI source failure never falls back to stale events in FA', async () => {
  const calls = [];
  const sources = createIndicatorSources({getAccessToken: async () => 'synthetic-service',
    fetchImpl: async url => {calls.push(url); return Response.json({}, {status: 503});}});
  const value = await sources.load('operations', 2026, 'FA.events');
  assert.deepEqual(value.sources.FA.events, {status: 'unavailable', rows: []});
  assert.equal(calls.length, 1); assert.ok(calls[0].includes('/projects/sahmt-operacional-fi/'));
});

test('indicators cannot configure operational source routes back to FA', () => {
  assert.equal('eventProject' in createIndicatorSources({getAccessToken: async () => 'synthetic'}), false);
});
