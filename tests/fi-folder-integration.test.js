import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiFolderReader} from '../worker-fi-control/folders.js';
import {renderFiControl} from '../src/fi-control-ui.js';

test('FI refuses a disabled source before its query and withholds results when policy changes',async()=>{
 let disabled=['operacao/etiquetas'];
 const guard=createFiFolderReader({readPolicy:async()=>({schemaVersion:1,revision:1,disabled}),readTrainingPolicy:async()=>null});
 const wrapped=guard.wrap({FH:{list:()=>assert.fail('blocked labels read')},FG:{list:()=>['allowed']}});
 await assert.rejects(wrapped.FH.list('labels'),{code:'FOLDER_DISABLED'});
 assert.deepEqual(await wrapped.FG.list('checklists'),['allowed']);
 disabled=['registros/qmentum'];
 await assert.rejects(guard.recheck(),{code:'FI_FOLDER_POLICY_CHANGED'});
 const fresh=createFiFolderReader({readPolicy:async()=>({schemaVersion:1,revision:2,disabled}),readTrainingPolicy:async()=>null});
 await assert.rejects(fresh.checkMonthly(),{code:'FOLDER_DISABLED'});
});

test('FI administrator can read sources behind disabled parents and HTML subfolders',async()=>{
 const guard=createFiFolderReader({administrator:true,
  readPolicy:()=>assert.fail('administrator reads without the general folder policy'),
  readTrainingPolicy:()=>assert.fail('administrator reads without the training folder policy')});
 await guard.checkMonthly();
 const wrapped=guard.wrap({FB:{get:()=>['document']},FJ:{get:()=>['schedule']}});
 assert.deepEqual(await wrapped.FB.get('htmlTrainings','protocol'),['document']);
 assert.deepEqual(await wrapped.FJ.get('scheduleDays','day'),['schedule']);
});

test('the FI folder panel requires service permission and stays absent from the pilot',()=>{
 const profile={permissions:{admin:true}};
 assert.match(renderFiControl({profile,showFolderAdmin:true}),/data-fi-folder-admin/);
 assert.doesNotMatch(renderFiControl({showFolderAdmin:true}),/data-fi-folder-admin/);
 assert.doesNotMatch(renderFiControl({profile,showFolderAdmin:true,pilot:true}),/data-fi-folder-admin/);
 assert.doesNotMatch(renderFiControl({profile,showFolderAdmin:true,searchOnly:true}),/data-fi-folder-admin/);
 assert.doesNotMatch(renderFiControl({profile}),/data-fi-folder-admin/);
});
import {createFiControlWorker} from '../worker-fi-control/worker.js';

test('FI rejects folder commands from a nonadministrator',async()=>{
 const worker=createFiControlWorker({
  verifyActor:async()=>({uid:'member',profile:{active:true,access:true}}),
  buildServices:()=>assert.fail('unexpected service'),
  buildFolderPublisher:()=>assert.fail('unexpected publisher')
 });
 const request=new Request('https://example.test/v1/control',{
  method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},
  body:JSON.stringify({action:'folders.inspect',input:{}})
 });
 assert.equal((await worker.fetch(request,{FI_CONTROL_ENABLED:'true',FI_FOLDER_MANAGEMENT_ENABLED:'true'})).status,403);
});
test('FI administrator inspects all replicas without starting the AI service',async()=>{
 const worker=createFiControlWorker({
  verifyActor:async()=>({uid:'fa-member',fiUid:'fi-member',profile:{active:true,access:true,role:'administrador_app'}}),
  buildServices:()=>assert.fail('unexpected service'),
  buildFolderPublisher:()=>({read:async()=>null,write:()=>assert.fail('inspection must be read only')})
 });
 const request=new Request('https://example.test/v1/control',{
  method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},
  body:JSON.stringify({action:'folders.inspect',input:{}})
 });
 const result=await worker.fetch(request,{FI_CONTROL_ENABLED:'true',FI_FOLDER_MANAGEMENT_ENABLED:'true'});
 assert.equal(result.status,200);
 assert.equal((await result.json()).stations.length,9);
});
