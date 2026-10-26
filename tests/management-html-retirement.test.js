import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {renderManagementDocumentCard} from '../src/management-document-folders.js';
import {createManagementAuthWorker} from '../worker-management-auth/worker.js';
import vm from 'node:vm';

test('document management cannot reopen PDF, Forms or ebook even with obsolete flags',()=>{
 const item={id:'evaluation_old-form',title:'Material antigo',managementAreaId:'area-gestao-de-documentos',category:'Protocolos',readingGateRequired:true,driveUrl:'https://docs.google.com/forms/d/e/OldForm/viewform',materialPdfUrl:'https://drive.google.com/file/d/OldPdf/view',driveFileId:'OldForm',materialPdfSourceFileId:'OldForm'};
 const html=renderManagementDocumentCard(item,{readingGate:true,canEdit:true});
 assert.match(html,/HTML/);
 assert.doesNotMatch(html,/data-open-diretriz-reader|data-open-material-viewer|href=|data-training-activity|data-document-edit/);
});
test('legacy reading endpoint is gone before building any remote runtime',async()=>{
 let runtimes=0;
 const worker=createManagementAuthWorker({buildRuntime:()=>{runtimes++;throw Error('must not run');}});
 const r=await worker.fetch(new Request('https://worker.test/v1/diretrizes/reading',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io'},body:'{}'}),{DIRETRIZES_READING_ENABLED:'true'});
 assert.equal(r.status,410);assert.equal((await r.json()).code,'READING_RETIRED');assert.equal(runtimes,0);
});
test('shell and publishing pipeline cannot reinstall the legacy reader',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const build=readFileSync(new URL('../scripts/build-independent-apps.mjs',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.doesNotMatch(main,/import\('\.\/diretrizes-ebook\.js'\)|diretrizesReadingRequested/);
 assert.match(main,/area\.id !== 'area-gestao-de-documentos'.*listManagementDocuments/);
 assert.equal(build.includes('DIRETRIZES_READING'),false);
 assert.doesNotMatch(workflow,/SAHMT_FB_READER_ENABLED: 'true'/);
});
test('obsolete reader implementation, relay and installers were deleted rather than hidden behind flags',()=>{
 for(const file of ['src/diretrizes-ebook.js','src/diretrizes-reading.js','apps-script-v2/DiretrizesReading.gs','apps-script-v2/ManagementEbookSetup.gs','apps-script-v2/ManagementPdfSync.gs','apps-script-v2/RopsReadingRelease.gs','apps-script-v2/TrainingRelease.gs','apps-script-v2/TrainingTemplateMigration.gs','apps-script-v2/TrainingTemplateAudit.gs','worker-management-auth/diretrizes-reading-relay.js'])assert.equal(existsSync(new URL('../'+file,import.meta.url)),false,file);
});

test('shared Forms services never reopen or credit retired document training',()=>{
 assert.equal(existsSync(new URL('../apps-script-v2/TrainingRepetition.gs',import.meta.url)),false);
 const cfg={status:'READY',managerAreaId:'area-gestao-de-documentos',eligibleGroups:['GENERAL']};
 const ctx=vm.createContext({evaluationGet_:()=>cfg});
 vm.runInContext(readFileSync(new URL('../apps-script-v2/FormsEvaluation.gs',import.meta.url),'utf8'),ctx);
 // No FormApp, UrlFetch, transaction or award service exists in this fixture: any call would fail.
 assert.equal(ctx.formsEvaluationProcessResponse_('old-form','old-response').status,'RETIRED');
 assert.equal(ctx.formsEvaluationFinalizePublication_('old-form').status,'RETIRED');
 assert.equal(ctx.formsEvaluationDocumentArea_({areaIds:['area-gestao-de-documentos']}),true);
 assert.equal(ctx.formsEvaluationDocumentArea_({managerAreaId:'other-area'}),false);
});

test('document area references are never crawled again by shared Forms discovery',()=>{
 const ctx=vm.createContext({
   formsEvaluationAll_:collection=>collection==='managementAreas'?[{id:'area-gestao-de-documentos',driveUrl:'https://drive.google.com/drive/folders/private'}]:[],
 });
 vm.runInContext(readFileSync(new URL('../apps-script-v2/FormsEvaluation.gs',import.meta.url),'utf8'),ctx);
 ctx.formsEvaluationAll_=collection=>collection==='managementAreas'?[{id:'area-gestao-de-documentos',driveUrl:'https://drive.google.com/drive/folders/private'}]:[];
 assert.equal(ctx.formsEvaluationReconcileLinks_().links,0);
});

test('retained Drive permission helper reads all pages and rejects a stalled cursor',()=>{
 const ctx=vm.createContext({});
 vm.runInContext(readFileSync(new URL('../apps-script-v2/ManagementDriveSupport.gs',import.meta.url),'utf8'),ctx);
 let calls=0;
 ctx.managementDriveJson_=url=>++calls===1?{permissions:[{id:'owner'}],nextPageToken:'next'}:(assert.match(url,/pageToken=next/),{permissions:[{id:'manager'}]});
 assert.equal(ctx.managementDrivePermissions_('fixture').length,2);
 assert.equal(calls,2);
 ctx.managementDriveJson_=()=>({permissions:[],nextPageToken:'same'});
 assert.throws(()=>ctx.managementDrivePermissions_('fixture'),/PERMISSIONS_LIMIT/);
});
