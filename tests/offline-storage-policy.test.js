import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/outbox.js';

test('operational cache writes and pruning do not touch Auth or device storage',async()=>{globalThis.indexedDB={open(){assert.fail('storage accessed');},deleteDatabase(){assert.fail('cleanup must be explicit');}};await api.writeSafeCache('u','stations','all',[{id:'s'}]);await api.cacheProfile('u',{access:true});await api.pruneLocalReadCache('u');assert.equal(await api.readCachedProfile('u'),null);assert.equal(await api.readFreshSafeCache('u','stations','all'),null);});
