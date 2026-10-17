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
