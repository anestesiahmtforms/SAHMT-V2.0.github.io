import test from 'node:test';
import assert from 'node:assert/strict';
import {repairAppFiles,staleModuleFailure} from '../src/app-repair.js';
test('stale module recovery preserves route and stops after one automatic attempt',()=>{
 const map=new Map(),urls=[],storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},location={assign:u=>urls.push(u)};
 const options={target:'FB',hash:'#/management/area-gestao-de-documentos',automatic:true,storage,location,now:1000};
 assert.equal(repairAppFiles(options),true);assert.equal(repairAppFiles({...options,now:1100}),false);
 const url=new URL(urls[0],'https://example.test');assert.equal(url.pathname,'/SAHMT-V2.0.github.io/gestao/tools/refresh-app.html');assert.equal(url.searchParams.get('route'),options.hash);
});
test('network/profile permission failures are not treated as missing JavaScript',()=>{
 assert.equal(staleModuleFailure(Error('Importing a module script failed.')),true);
 assert.equal(staleModuleFailure(Error('Failed to fetch dynamically imported module: https://example.test/a.js')),true);
 assert.equal(staleModuleFailure(Error('Unable to preload CSS for https://example.test/training.css')),true);
 assert.equal(staleModuleFailure(Error('Missing or insufficient permissions')),false);
 assert.equal(staleModuleFailure(Error('auth/invalid-credential')),false);
});
test('recovery refuses external targets and cannot auto-loop when storage fails',()=>{
 const urls=[],location={assign:u=>urls.push(u)},storage={getItem(){throw Error('blocked');}};
 assert.equal(repairAppFiles({target:'FB',hash:'#/management',automatic:true,storage,location}),false);
 assert.equal(repairAppFiles({target:'https://example.com',location}),false);
 assert.equal(repairAppFiles({hash:'javascript:alert(1)',location}),false);assert.deepEqual(urls,[]);
});

