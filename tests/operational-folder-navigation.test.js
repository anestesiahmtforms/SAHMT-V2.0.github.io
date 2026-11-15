import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {operationalFolders,operationalFolderAllowed,operationalRouteFolder,initialOperationalFolderPolicy} from '../src/operational-folders.js';
import {renderOperationalFolderDirectory} from '../src/operational-folder-directory.js';

const runtime=readFileSync(new URL('../src/operational-folder-runtime.js',import.meta.url),'utf8')
 .replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env?.VITE_FOLDER_POLICY_ENABLED',"'true'");
function fixture(disabled) {
 const context=vm.createContext({deployment:{target:'FA'},operationalFolders,operationalFolderAllowed,operationalRouteFolder,initialOperationalFolderPolicy,governanceSessionReady:()=>true});
 vm.runInContext(runtime,context);
 const set=disabled=>vm.runInContext('policy='+JSON.stringify({schemaVersion:1,revision:1,disabled}),context);
 set(disabled);
 return {run:code=>vm.runInContext(code,context),set};
}

test('inactive parent and descendants remain navigable while activities fail closed',()=>{
 const f=fixture(['operacao']);
 for(const route of ['checklist','labels','schedule','events']){
  assert.equal(f.run('operationalFolderRouteAllowed('+JSON.stringify(route)+')'),true);
  assert.equal(f.run('operationalRouteActivityAllowed('+JSON.stringify(route)+')'),false);
 }
 assert.throws(()=>f.run("assertOperationalContentAllowed('operacao/checklist')"),{code:'FOLDER_DISABLED'});
 assert.match(f.run("operationalFolderNotice('operacao/checklist')"),/Subpasta inativa[\s\S]*navegar/);
 assert.doesNotMatch(f.run("operationalFolderNotice('operacao/checklist')"),/fi-control/);
 f.set(['operacao/checklist']);
 assert.equal(f.run("operationalRouteActivityAllowed('schedule')"),true);
 assert.equal(f.run("operationalRouteActivityAllowed('checklist')"),false);
 f.set([]);
 assert.equal(f.run("operationalRouteActivityAllowed('checklist')"),true);
});

test('missing availability confirmation permits navigation and blocks activity; admin inspection remains available',()=>{
 const f=fixture([]);
 f.run('policy=null');
 assert.equal(f.run("operationalFolderRouteAllowed('labels')"),true);
 assert.equal(f.run("operationalRouteActivityAllowed('labels')"),false);
 assert.match(f.run("operationalFolderNotice('operacao/etiquetas')"),/confirma/);
 f.set(['operacao']);
 f.run("setOperationalFolderSession({profile:{role:'administrador_app'}})");
 assert.equal(f.run("operationalRouteActivityAllowed('labels')"),true);
 assert.match(f.run("operationalFolderNotice('operacao/etiquetas')"),/Reativar no Controle/);
});

test('inactive directory exposes each nested folder without activity actions and prunes unauthorized branches',()=>{
 const html=renderOperationalFolderDirectory('funcional');
 assert.match(html,/<summary>Pesquisas institucionais<\/summary>[\s\S]*<summary>Pesquisa de clima/);
 assert.match(html,/<summary>Biossegurança<\/summary>[\s\S]*<summary>Dosimetria/);
 assert.doesNotMatch(html,/<button|<iframe|href=/);
 const folders={'root':'Raiz','root/public':'Pública','root/private':'Restrita','root/private/secret':'Segredo'};
 const restricted=renderOperationalFolderDirectory('root',{folders,allowed:id=>id!=='root/private'});
 assert.match(restricted,/Pública/);
 assert.doesNotMatch(restricted,/Restrita|Segredo/);
});
