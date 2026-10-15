import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const result={code:'FA_CONSOLIDATION_LOCAL_PREPARATION',checks:[],remoteWrites:0,productionReady:false};
try{
 if(process.platform==='win32'){
  const portable=resolve(process.env.LOCALAPPDATA,'SAHMT','tools','mingit-2.56.0.2','cmd');
  if(existsSync(resolve(portable,'git.exe')))process.env.PATH=portable+';'+process.env.PATH;
 }
 for(const name of await readdir(resolve(root,'apps-script-v2'))){
  if(name.endsWith('.gs'))new vm.Script(await readFile(resolve(root,'apps-script-v2',name),'utf8'),{filename:name});
 }
 result.checks.push({name:'apps-script-syntax',passed:true});
 const tasks=[['consolidation-tests',['scripts/test-fa-consolidation.mjs']],
  ['domain-tests',[process.env.npm_execpath,'run','test:domain']],
  ['management-tests',['scripts/test-management.mjs']],
  ['secondary-domain-tests',[process.env.npm_execpath,'run','test:secondary-domain']],
  ['build',['node_modules/vite/bin/vite.js','build']]];
 if(!process.env.npm_execpath)throw Error('CONSOLIDATION_RUN_WITH_NPM');
 for(const [name,args]of tasks){
  console.log(JSON.stringify({code:'CONSOLIDATION_LOCAL_CHECK_RUNNING',check:name}));
  const run=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',shell:false,
   env:{VITE_FIREBASE_PROJECT_AUTH_ENABLED:'false',VITE_INDICATORS_FIREBASE_ENABLED:'false',VITE_FIREBASE_PROJECT_AUTH_ENDPOINT:'',VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN:'',
    ...process.env,VITE_MANAGEMENT_DATA_PROJECT:'FA',VITE_EVALUATION_DATA_PROJECT:'FA',VITE_MANAGEMENT_FIREBASE_ENABLED:'false'}});
  result.checks.push({name,passed:run.status===0&&!run.error});
  if(run.status!==0||run.error)throw Error('CONSOLIDATION_LOCAL_CHECK_FAILED');
 }
 result.localReady=true;
 result.externalGates=['source-writer-barrier','final-delta-and-backup','verified-copy','backend-version-and-control-markers','production-build-and-authenticated-validation'];
}catch(error){result.code=/^CONSOLIDATION_[A-Z_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_LOCAL_PREPARATION_FAILED';process.exitCode=1;}
const output=resolve(root,'artifacts','fa-consolidation');await mkdir(output,{recursive:true});
await writeFile(resolve(output,'preparation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
