import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/outbox.js';

test('operational reads after page restoration do not open IndexedDB',async()=>{globalThis.indexedDB={open(){assert.fail('retired operational storage opened');}};assert.equal(await api.readSafeCache('u','events','day'),null);assert.equal(await api.readCachedProfile('u'),null);assert.deepEqual(await api.listUnsettledOperations('u'),[]);});
