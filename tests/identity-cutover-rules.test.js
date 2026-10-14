import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {prepareIdentityCutoverRules} from '../scripts/lib/identity-cutover-rules.js';
const source=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
test('cutover guards only approved domains and preserves general notices and operational matches',()=>{
 const output=prepareIdentityCutoverRules(source);
 assert.match(output,/function faDomainOpen_/);
 const part=(s,name)=>s.slice(s.indexOf('match /'+name+'/'),s.indexOf('match /',s.indexOf('match /'+name+'/')+7));
 for(const name of ['events','labels','users','checklists','stations','notificationGroups'])assert.equal(part(output,name),part(source,name),name);
 assert.match(part(output,'trainings'),/allow create: if faDomainOpen_\(true\) &&/);
 assert.match(part(output,'evaluationAwards'),/allow read: if faDomainOpen_\(false\) &&/);
 assert.match(part(output,'notifications'),/audienceType != 'MANAGEMENT_AREA'/);
 assert.throws(()=>prepareIdentityCutoverRules(output),/ALREADY/);
});
