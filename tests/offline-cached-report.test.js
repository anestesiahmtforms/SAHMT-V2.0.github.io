import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('production report adapter never emits an operational device cache',async()=>{
 const ctx=vm.createContext({readSafeCache(){assert.fail('cache read');}});
 vm.runInContext(main.slice(main.indexOf('async function emitCachedOfflineReport('),main.indexOf('async function subscribeLiveReport(')),ctx);
 for(const kind of ['events','labels','checklist'])assert.equal(await ctx.emitCachedOfflineReport(kind,{}, {next(){assert.fail('cache painted');}}),false);
});
