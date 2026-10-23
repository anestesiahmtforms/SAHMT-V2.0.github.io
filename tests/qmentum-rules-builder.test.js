import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const base=(await readFile(new URL('../firestore.rules',import.meta.url),'utf8')).replaceAll('\r\n','\n');
test('rebuilding a current release replaces only the bounded QMENTUM fragment without duplication',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sahmt-qmentum-rules-')),files=['base.rules','first.rules','second.rules'].map(n=>join(dir,n));
 try{await writeFile(files[0],base);for(const [input,output] of [[files[0],files[1]],[files[1],files[2]]])execFileSync(process.execPath,['scripts/build-qmentum-rules.mjs','--base',input,'--out',output],{stdio:'pipe',windowsHide:true});
 const first=await readFile(files[1],'utf8'),second=await readFile(files[2],'utf8');assert.equal(first.replace(/\n+/g,'\n'),second.replace(/\n+/g,'\n'));assert.equal(second.split('// BEGIN QMENTUM_FA').length,2);
 }finally{for(const path of files)await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(dir);}
});
test('incomplete markers and QMENTUM grants outside the managed fragment fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sahmt-qmentum-rules-')),input=join(dir,'base.rules'),output=join(dir,'output.rules');
 try{for(const text of [base+'\n// BEGIN QMENTUM_FA',base.replace('  }\n}',"match /qmentumOther/{id} { allow read: if true; }\n  }\n}")]){await writeFile(input,text);assert.throws(()=>execFileSync(process.execPath,['scripts/build-qmentum-rules.mjs','--base',input,'--out',output],{stdio:'pipe',windowsHide:true}));}}
 finally{for(const path of [input,output])await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(dir);}
});
