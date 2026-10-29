import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stampShellRelease} from '../scripts/lib/shell-release.js';

const worker=readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8');
test('each build installs its own HTML and asset cache even without a hand-edited worker',()=>{
  const first=stampShellRelease(worker,1793278000000),second=stampShellRelease(worker,1793278000001);
  assert.notEqual(first,second);assert.match(first,/const CACHE = 'sahmt-v2-shell-v1793278000000';/);
  assert.equal(first.slice(first.indexOf('\n')),worker.slice(worker.indexOf('\n')));
  const fb=second.replaceAll('sahmt-v2-','sahmt-fb-v2-');
  assert.match(fb,/const CACHE = 'sahmt-fb-v2-shell-v1793278000001';/);
});
test('invalid releases and a missing cache declaration cannot publish silently',()=>{
  for(const release of ['',0,-1,'bad',Infinity,'123;malicious()'])assert.throws(()=>stampShellRelease(worker,release),/INVALID/);
  assert.throws(()=>stampShellRelease('no cache declaration',123),/MISSING/);
});
