import test from 'node:test';
import assert from 'node:assert/strict';
import {runKeyedTask} from '../src/keyed-task.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
}

test('coalesces concurrent work for the same UID and cleans up on completion', async () => {
  const tasks = new Map();
  const gate = deferred();
  let calls = 0;
  const first = runKeyedTask(tasks, 'uid-a', () => { calls++; return gate.promise; });
  const duplicate = runKeyedTask(tasks, 'uid-a', () => { calls++; return 'unexpected'; });
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);
  gate.resolve('done');
  assert.equal(await first, 'done');
  await Promise.resolve();
  assert.equal(tasks.has('uid-a'), false);
});

test('does not join work belonging to a different UID', async () => {
  const tasks = new Map();
  const firstGate = deferred();
  const secondGate = deferred();
  const first = runKeyedTask(tasks, 'uid-a', () => firstGate.promise);
  const second = runKeyedTask(tasks, 'uid-b', () => secondGate.promise);
  assert.notEqual(first, second);
  await Promise.resolve();
  assert.deepEqual([...tasks.keys()].sort(), ['uid-a', 'uid-b']);
  firstGate.resolve('a');
  secondGate.resolve('b');
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
});
