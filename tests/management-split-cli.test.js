import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync,symlinkSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {snapshotDigest,documentDigest} from '../scripts/lib/management-split-plan.js';

const repo=resolve(import.meta.dirname,'..'), script=join(repo,'scripts','management-split-plan.mjs');
function fixture() {
  const root=join(repo,'.local-preview');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'management-split-cli-'));
  const document={path:'managementAreas/demo',fields:{id:{stringValue:'demo'}},createTime:'2026-10-08T12:00:00Z',updateTime:'2026-10-08T12:00:00Z'};
  const snapshot={schemaVersion:1,projectId:'sahmt-17a16',databaseId:'(default)',readTime:'2026-10-08T12:00:00Z',coverage:{complete:true,consistent:true,rootCollections:['managementAreas']},documents:[document]};
  const manifest={schemaVersion:1,sourceProjectId:'sahmt-17a16',sourceDatabaseId:'(default)',destinationProjectId:'demo-gestao-split',destinationDatabaseId:'(default)',backupSha256:snapshotDigest(snapshot),identityMappings:[],entries:[{path:document.path,sourceSha256:documentDigest(document),action:'COPY',reason:'Área demonstrativa sintética',dependencies:[]}]};
  const backup=join(directory,'backup.json'),selection=join(directory,'manifest.json'),output=join(directory,'plan.json'),destination=join(directory,'destination.json');
  writeFileSync(backup,JSON.stringify(snapshot));writeFileSync(selection,JSON.stringify(manifest));writeFileSync(destination,JSON.stringify({...snapshot,projectId:manifest.destinationProjectId,coverage:{...snapshot.coverage,rootCollections:['managementAreas','migrationOrigins']},documents:[]}));
  const run=out=>spawnSync(process.execPath,[script,'--backup',backup,'--manifest',selection,'--out',out,'--destination',destination],{cwd:repo,encoding:'utf8'});
  const cleanup=()=>{for(const path of [backup,selection,output,destination])if(existsSync(path))unlinkSync(path);rmdirSync(directory);};
  return {directory,output,run,cleanup};
}
test('CLI cria somente arquivo ignorado, loga resumo e não sobrescreve plano',()=>{
  const f=fixture();try {const result=f.run(f.output);assert.equal(result.status,0,result.stderr);const summary=JSON.parse(result.stdout);assert.equal(summary.mode,'OFFLINE_DRY_RUN');assert.equal(summary.counts.copy,1);assert.equal(summary.productionAuthorized,false);assert.equal(result.stdout.includes('Área demonstrativa'),false);const before=readFileSync(f.output,'utf8');const repeat=f.run(f.output);assert.equal(repeat.status,1);assert.equal(JSON.parse(repeat.stderr).error,'EEXIST');assert.equal(readFileSync(f.output,'utf8'),before);}finally{f.cleanup();}
});
test('CLI rejeita saída versionada e symlink/junction de diretório',()=>{
  const f=fixture(),link=join(f.directory,'escape'),target=mkdtempSync(join(repo,'.local-preview','management-split-target-'));
  const linkedOutput=join(link,'plan.json');
  const checkIgnored=()=>spawnSync('git',['check-ignore','--quiet','--no-index',linkedOutput],{
    cwd:repo,encoding:'utf8',env:{...process.env,LC_ALL:'C',LANG:'C'}
  });
  try {
    const versioned=f.run(join(repo,'docs','migration-private-leak.json'));
    assert.equal(versioned.status,1);
    assert.equal(JSON.parse(versioned.stderr).error,'OUTPUT_MUST_BE_IN_LOCAL_PREVIEW');
    assert.equal(existsSync(join(repo,'docs','migration-private-leak.json')),false);
    // Confirm this output is ignored before replacing its ordinary parent with a link.
    mkdirSync(link);const ordinary=checkIgnored();assert.equal(ordinary.status,0,ordinary.stderr);rmdirSync(link);
    symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
    assert.equal(lstatSync(link).isSymbolicLink(),true);
    const ignored=checkIgnored(),linked=f.run(linkedOutput);
    assert.equal(linked.status,1);
    if(process.platform==='win32') {
      assert.equal(ignored.status,0,ignored.stderr);
      assert.equal(JSON.parse(linked.stderr).error,'OUTPUT_LINK_FORBIDDEN');
    } else {
      // Git rejects traversal through symlinks before the CLI reaches its lstat guard.
      assert.equal(ignored.status,128,ignored.stderr);
      assert.match(ignored.stderr,/beyond a symbolic link/);
      assert.equal(JSON.parse(linked.stderr).error,'OUTPUT_MUST_BE_GIT_IGNORED');
    }
    assert.equal(existsSync(join(target,'plan.json')),false);
  } finally {
    if(existsSync(link)) {if(lstatSync(link).isSymbolicLink())unlinkSync(link);else rmdirSync(link);}
    rmdirSync(target);f.cleanup();
  }
});
