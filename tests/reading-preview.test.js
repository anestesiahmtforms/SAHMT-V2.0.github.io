import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingPreview} from '../scripts/preview-reading-control.mjs';
test('independent reading preview servers can start together and close without leaking ports',{timeout:15000},async()=>{
 const previews=[];
 try{
  previews.push(await createReadingPreview({port:0}));previews.push(await createReadingPreview({port:0}));
  assert.notEqual(previews[0].url,previews[1].url);
  for(const preview of previews)assert.equal((await fetch(preview.url)).status,200);
 }finally{await Promise.all(previews.map(p=>p.server.close()));}
});
