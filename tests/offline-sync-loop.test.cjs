const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
test('backend suspenso não faz flush nem rearma tentativas imediatas da outbox', async () => {
  let writes = 0, timers = 0;
  const ctx = vm.createContext({navigator: {onLine: true}, onlineValidationRequired: false, isOfflineRuntimeForced: () => true,
    session: {status: 'signed-in', user: {uid: 'fixture'}, profile: {active: true, access: true}},
    operationCounts: async () => ({queued: 1}), pendingTrainingProgressCount: async () => 0,
    mockData: {flushOutbox: async () => {writes++;}, syncPendingTrainingProgress: async () => {}}, canConfirmOfflineOperation: () => true,
    updateOutboxStatus: async () => {}, currentRoute: () => 'home', scheduleNextOutboxRetry: async () => {timers++;}, console});
  const fn = source.slice(source.indexOf('async function syncOutbox()'), source.indexOf('async function revalidateOnlineSession()')).replace("import('./data.js')", 'Promise.resolve(mockData)');
  vm.runInContext(fn, ctx); await ctx.syncOutbox();
  assert.equal(writes, 0); assert.equal(timers, 0);
});
