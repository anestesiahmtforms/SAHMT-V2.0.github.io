import test from 'node:test';
import assert from 'node:assert/strict';
import {installOperationalDrafts} from '../src/offline-form-drafts.js';
test('form lifecycle never installs input persistence or restores a draft',async()=>{
 const drafts=installOperationalDrafts({root:{addEventListener(){assert.fail('persistent input listener');}},getSession:()=>({status:'signed-in'})});
 assert.equal(drafts.checkpoint({}),null);assert.equal(await drafts.restore({}),false);await drafts.flush();await drafts.clearSubmitted({});drafts.destroy();
});
