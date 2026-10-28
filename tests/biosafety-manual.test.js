import test from 'node:test';import assert from 'node:assert/strict';
import {MANUAL_CSP,MANUAL_HTML_LIMIT,manualSha256,validateManualRecord} from '../src/biosafety-manual-policy.js';
import {validateManualHtmlStructure} from '../scripts/lib/biosafety-manual-import.js';
import {createBiosafetyManualService} from '../worker-training/biosafety-manual-service.js';
import {createTrainingWorker} from '../worker-training/worker.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${MANUAL_CSP}"><style>html{scroll-behavior:smooth}</style><title>Manual sintético</title></head><body><h1>Manual sintético</h1><p>Conteúdo de demonstração.</p></body></html>`;
const identity={uid:'synthetic',email:'person@example.invalid',emailVerified:true,provider:'google.com'};
async function record(){return {schemaVersion:1,status:'VERIFIED',title:'Manual sintético',documentCode:'SYNTHETIC',revision:'01',issuedOn:'2025-01-01',sourceSha256:'a'.repeat(64),contentSha256:await manualSha256(new TextEncoder().encode(html)),html};}
async function fixture(){const store=vaccinationMemoryStore();store.seed('users',identity.uid,{...identity,active:true,access:true});store.seed('institutionalBiosafetyManuals','hmt',await record());return {store,service:createBiosafetyManualService({store})};}
test('manual is source-bound and rejects changed, executable, oversized or undated content',async()=>{
 const current=await record();await validateManualRecord(current);assert.equal(validateManualHtmlStructure(html).headings,1);
 for(const patch of [{status:'DRAFT'},{issuedOn:'2025-02-30'},{html:html+'changed'},{html:'x'.repeat(MANUAL_HTML_LIMIT+1)},{html:html.replace('default-src','changed-src')}])await assert.rejects(validateManualRecord({...current,...patch}));
 for(const unsafe of ['<script>alert(1)</script>','<iframe src="https://example.invalid"></iframe>','<img src="https://example.invalid/a.png">','<img src="data:image/svg+xml;base64,AAAA">','<p onclick="alert(1)">x</p>','<style>@import "https://example.invalid/a.css"</style>','<style>p{behavior:url(x)}</style>','<a href="https://example.invalid">x</a>'])assert.throws(()=>validateManualHtmlStructure(unsafe));
});
test('only the verified current approved account can read the fixed manual; no selectors or write actions exist',async()=>{
 const {store,service}=await fixture();const result=await service.execute('GET_MANUAL',{},identity);assert.equal(result.html,html);for(const field of ['uid','email','sourceSha256','contentSha256'])assert.equal(result[field],undefined);
 for(const input of [{uid:'other'},{documentId:'other'},{url:'https://example.invalid'},{html:'injected'}])await assert.rejects(service.execute('GET_MANUAL',input,identity));
 await assert.rejects(service.execute('SAVE',{},identity));
 for(const patch of [{emailVerified:false},{provider:'password'},{uid:'../other'}])await assert.rejects(service.execute('GET_MANUAL',{},{...identity,...patch}));
 for(const patch of [{active:false},{access:false},{email:'other@example.invalid'},{uid:'other'}]){store.seed('users',identity.uid,{...identity,active:true,access:true,...patch});await assert.rejects(service.execute('GET_MANUAL',{},identity),e=>e.code==='MANUAL_FORBIDDEN');}
});
test('missing and corrupt manuals fail closed and access revocation is checked on every request',async()=>{
 const {store,service}=await fixture();store.seed('institutionalBiosafetyManuals','hmt',null);await assert.rejects(service.execute('GET_MANUAL',{},identity),e=>e.code==='MANUAL_NOT_FOUND');
 store.seed('institutionalBiosafetyManuals','hmt',{...await record(),html:'modified'});await assert.rejects(service.execute('GET_MANUAL',{},identity),e=>e.code==='MANUAL_UNAVAILABLE');
 store.seed('institutionalBiosafetyManuals','hmt',await record());await service.execute('GET_MANUAL',{},identity);store.seed('users',identity.uid,{...identity,active:true,access:false});await assert.rejects(service.execute('GET_MANUAL',{},identity),e=>e.code==='MANUAL_FORBIDDEN');
});
test('manual route uses FB authentication, no-store responses and an explicit default-off flag',async()=>{
 const worker=createTrainingWorker({verifyIdentity:async(header,options)=>{assert.equal(options.apiKey,'fb-key');return identity;},buildManualService:()=>({execute:async()=>({title:'Synthetic'})})});
 const request=()=>new Request('https://worker.test/v1/biosafety-manual',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify({action:'GET_MANUAL',input:{}})});
 assert.equal((await worker.fetch(request(),{})).status,503);const result=await worker.fetch(request(),{BIOSAFETY_MANUAL_ENABLED:'true',FB_WEB_API_KEY:'fb-key'});assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');
});
