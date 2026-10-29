import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('FA dependency verification accepts the shared view while rejecting unrelated files and retired auth',()=>{
 const root=mkdtempSync(join(tmpdir(),'sahmt-runtime-'));
 try{
  for(const dir of ['src','scripts','indicators-platform','dist/assets'])mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'scripts/check-fa-runtime.mjs'),readFileSync(new URL('../scripts/check-fa-runtime.mjs',import.meta.url)));
  writeFileSync(join(root,'src/main.js'),"import '../indicators-platform/ui.js';");
  writeFileSync(join(root,'indicators-platform/ui.js'),"import './ui.css';");
  writeFileSync(join(root,'indicators-platform/ui.css'),'');
  writeFileSync(join(root,'index.html'),['firebase-project-auth-optin','management-firebase-enabled','indicators-firebase-enabled'].map(name=>'<meta name="'+name+'" content="false">').join(''));
  writeFileSync(join(root,'dist/assets-manifest.json'),'{}');
  const check=()=>spawnSync(process.execPath,[join(root,'scripts/check-fa-runtime.mjs')],{encoding:'utf8',timeout:10000});
  const valid=check();assert.ifError(valid.error);assert.equal(valid.status,0,valid.stderr);assert.equal(JSON.parse(valid.stdout).reachableSourceFiles,3);
  for(const path of ['./entry.js','../worker-indicators/store.js']){
   writeFileSync(join(root,'indicators-platform/ui.js'),'import '+JSON.stringify(path)+';');
   const blocked=check();assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/FA_RUNTIME_PATH_INVALID/);
  }
  writeFileSync(join(root,'indicators-platform/ui.js'),"import '../src/firebase-project-auth-browser.js';");
  writeFileSync(join(root,'src/firebase-project-auth-browser.js'),'');
  const retired=check();assert.notEqual(retired.status,0);assert.match(retired.stderr,/FA_RETIRED_RUNTIME_REACHABLE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
