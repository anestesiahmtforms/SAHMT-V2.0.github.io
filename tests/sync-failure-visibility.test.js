import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('retired synchronization badge never reads or offers retry of old queues',async()=>{
 const target={textContent:'old synchronization status'},ctx=vm.createContext({document:{querySelector:()=>target},listUnsettledOperations(){assert.fail('queue read');}});
 vm.runInContext(main.slice(main.indexOf('async function updateOutboxStatus()'),main.indexOf('function bindProfileRetryControl')),ctx);await ctx.updateOutboxStatus();assert.equal(target.textContent,'');
});
