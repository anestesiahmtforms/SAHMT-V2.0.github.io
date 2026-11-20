import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {operationalFolders,operationalFolderAllowed,operationalRouteFolder,initialOperationalFolderPolicy} from '../src/operational-folders.js';
import {renderOperationalFolderDirectory} from '../src/operational-folder-directory.js';

const runtime=readFileSync(new URL('../src/operational-folder-runtime.js',import.meta.url),'utf8')
 .replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env?.VITE_FOLDER_POLICY_ENABLED',"'true'");
function fixture(disabled) {
 const context=vm.createContext({deployment:{target:'FA'},operationalFolders,operationalFolderAllowed,operationalRouteFolder,initialOperationalFolderPolicy,governanceSessionReady:()=>true,setFunctionalFolderSession:()=>{}});
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
 assert.equal(f.run("operationalFolderState('operacao/checklist')"),'inactive');
 f.set(['operacao/checklist']);
 assert.equal(f.run("operationalRouteActivityAllowed('schedule')"),true);
 assert.equal(f.run("operationalFolderState('operacao/escala')"),'active');
 assert.equal(f.run("operationalRouteActivityAllowed('checklist')"),false);
 f.set([]);
 assert.equal(f.run("operationalRouteActivityAllowed('checklist')"),true);
});

test('missing availability confirmation permits navigation and blocks activity; admin inspection remains available',()=>{
 const f=fixture([]);
 f.run('policy=null');
 assert.equal(f.run("operationalFolderRouteAllowed('labels')"),true);
 assert.equal(f.run("operationalRouteActivityAllowed('labels')"),false);
 assert.equal(f.run("operationalFolderState('operacao/etiquetas')"),null);
 f.set(['operacao']);
 f.run("setOperationalFolderSession({profile:{role:'administrador_app'}})");
 assert.equal(f.run("operationalRouteActivityAllowed('labels')"),true);
 assert.equal(f.run("operationalFolderState('operacao/etiquetas')"),'inactive');
 f.set([]);
 assert.equal(f.run("operationalFolderState('operacao/etiquetas')"),'active');
});

test('inactive directory exposes each nested folder without activity actions and prunes unauthorized branches',()=>{
 const html=renderOperationalFolderDirectory('funcional',{folderState:id=>id.includes('biosseguranca')?'active':'inactive'});
 assert.match(html,/<summary data-folder-state="inactive"><span>Pesquisas institucionais<\/span><\/summary>[\s\S]*<summary data-folder-state="inactive"><span>Pesquisa de clima/);
 assert.match(html,/<summary data-folder-state="active"><span>Biossegurança<\/span><\/summary>[\s\S]*<summary data-folder-state="active"><span>Dosimetria/);
 assert.doesNotMatch(html,/<button|<iframe|href=|role="status"|INATIVA/);
 const folders={'root':'Raiz','root/public':'Pública','root/private':'Restrita','root/private/secret':'Segredo'};
 const restricted=renderOperationalFolderDirectory('root',{folders,allowed:id=>id!=='root/private'});
 assert.match(restricted,/Pública/);
 assert.doesNotMatch(restricted,/Restrita|Segredo/);
});
