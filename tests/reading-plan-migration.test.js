import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalDigest} from '../scripts/lib/reading-plan-migration.js';
test('reading plan migration accepts Firestore field ordering without accepting changed material',()=>{
 const listed={id:'item',title:'Texto',source:{document:'a',questions:'b'},version:4};
 const fetched={version:4,source:{questions:'b',document:'a'},title:'Texto',id:'item'};
 assert.equal(canonicalDigest(listed),canonicalDigest(fetched));
 assert.notEqual(canonicalDigest(listed),canonicalDigest({...fetched,version:5}));
});
