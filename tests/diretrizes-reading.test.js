import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingClient,readingGateConfig} from '../src/diretrizes-reading.js';
import {renderManagementDocumentCard} from '../src/management-document-folders.js';
test('configuration disabled by default and refuses insecure endpoint',()=>{
 assert.equal(readingGateConfig({}).enabled,false);
 assert.equal(readingGateConfig({VITE_DIRETRIZES_READING_ENABLED:'true',VITE_DIRETRIZES_READING_ENDPOINT:'http://evil.test'}).enabled,false);
});
test('opt-in card never exposes Form href',()=>{
 const html=renderManagementDocumentCard({id:'doc',title:'Diretriz',category:'DIRETRIZES',driveUrl:'https://docs.google.com/forms/d/e/PrivatePublic123/viewform'},{readingGate:true});
 assert.match(html,/data-open-diretriz-reader/);assert.doesNotMatch(html,/href=/);
});
test('identity switch while pending rejects delayed response',async()=>{
 let current={uid:'first',getIdToken:async()=> 'test'},finish;
 const client=createReadingClient({endpoint:'https://worker.test/v1/diretrizes/reading',getUser:()=>current,fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=client.request({action:'start',documentId:'doc'});
 await new Promise(resolve=>setTimeout(resolve,0));current={uid:'second'};finish(Response.json({code:'READING_STARTED'}));
 await assert.rejects(pending,/READING_USER_CHANGED/);
});

for(const category of ['Protocolos','ROPs','DIRETRIZES','Documentos administrativos','Organograma'])test('reading card covers '+category+' without exposing a direct Form',()=>{
 const html=renderManagementDocumentCard({id:'catalog-id',category,title:category,driveUrl:'https://docs.google.com/forms/d/e/PrivatePublic123/viewform'},{readingGate:true});
 assert.match(html,/data-open-diretriz-reader="catalog-id"/);assert.doesNotMatch(html,/href=/);
});

test('paired PDF card resolves the original canonical evaluation document',()=>{
 const html=renderManagementDocumentCard({id:'pdf_evaluation_FormFixture123456',title:'PDF',category:'Protocolos'},{readingGate:true});assert.match(html,/data-open-diretriz-reader="evaluation_FormFixture123456"/);
});

test('reading gate preserves the existing manager edit action without a direct Form link',()=>{
 const item={id:'evaluation_FormFixture123456',documentCollection:'scopedDocuments',title:'Documento',category:'Protocolos',driveUrl:'https://docs.google.com/forms/d/e/PrivatePublic123/viewform'};
 const manager=renderManagementDocumentCard(item,{readingGate:true,canEdit:true});
 assert.match(manager,/data-document-edit="scopedDocuments\/evaluation_FormFixture123456"/);
 assert.match(manager,/data-open-diretriz-reader=/);assert.doesNotMatch(manager,/href=/);
 assert.doesNotMatch(renderManagementDocumentCard(item,{readingGate:true}),/data-document-edit=/);
});
