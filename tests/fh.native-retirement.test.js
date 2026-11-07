import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../apps-script-v2/FhMigration.gs',import.meta.url),'utf8');
const base='https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents';
test('FH native retirement is disabled in an unstamped template and blocks only FA label writes after publication',()=>{
 for(const active of [false,true]){
  const c=vm.createContext({});vm.runInContext(source.replace('const SAHMT_FH_PUBLICATION_EPOCH = 0;','const SAHMT_FH_PUBLICATION_EPOCH = '+(active?1:0)+';'),c);
  for(const path of ['/labels/l1','/labels/l1/history/2','/appConfig/labelStaff']){const run=()=>c.sahmtFhGuardWrite_(base+path,{method:'patch'});if(active)assert.throws(run,/FH_SOURCE_MOVED/);else run();}
  for(const method of ['get','post'])c.sahmtFhGuardWrite_(base+':runQuery',{method,payload:'{}'});
  for(const path of ['/checklists/c1','/users/u1','/appConfig/app'])c.sahmtFhGuardWrite_(base+path,{method:'patch'});
  c.sahmtFhGuardWrite_(base.replace('sahmt-17a16','sahmt-etiquetas-fh')+'/labels/l1',{method:'patch'});
 }
});
test('FH native retirement catches atomic update, delete, transform and label recovery writes',()=>{
 const c=vm.createContext({});vm.runInContext(source.replace('const SAHMT_FH_PUBLICATION_EPOCH = 0;','const SAHMT_FH_PUBLICATION_EPOCH = 1;'),c);const root=base.replace('https://firestore.googleapis.com/v1/','');
 for(const write of [{update:{name:root+'/labels/l1'}},{delete:root+'/labels/l1'},{transform:{document:root+'/labels/l1'}},{update:{name:root+'/operationalSheetArchives/a',fields:{sourceKey:{stringValue:'labels/l1'}}}}])assert.throws(()=>c.sahmtFhGuardWrite_(base+':commit',{method:'post',payload:JSON.stringify({writes:[write]})}),/FH_SOURCE_MOVED/);
 c.sahmtFhGuardWrite_(base+':commit',{method:'post',payload:JSON.stringify({writes:[{update:{name:root+'/checklists/c1'}}]})});
});
