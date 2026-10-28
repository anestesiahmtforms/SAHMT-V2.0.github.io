import test from 'node:test';import assert from 'node:assert/strict';
import {dosimetryValue,dosimetryMonths,normalizeProfessionalName,validateDosimetryRecord} from '../src/dosimetry-domain.js';
import {createDosimetryService} from '../worker-training/dosimetry-service.js';import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';import {buildDosimetryImportPlan} from '../scripts/lib/dosimetry-import-plan.js';import {createTrainingWorker} from '../worker-training/worker.js';
const identity=uid=>({uid,email:`${uid}@example.invalid`,emailVerified:true,provider:'google.com'});
const sourceName='Profissional de Demonstração';
const record=uid=>({schemaVersion:1,status:'VERIFIED',uid,email:identity(uid).email,year:2026,sourceName,values:['ANR','0,2',...Array(10).fill(null)],monitorType:'28',quantity:'Hp(10)',unit:'mSv',issuedOn:'2026-04-13',sourceFingerprint:'a'.repeat(64),sourceFileId:'SYNTHETIC_PDF_FILE',sourceFolderId:'SYNTHETIC_FOLDER',matchMethod:'official-contact-name-and-email'});
function fixture(){const store=vaccinationMemoryStore();for(const uid of ['one','two','admin']){store.seed('users',uid,{uid,email:identity(uid).email,displayName:'Editable display name',active:true,access:true,role:uid==='admin'?'administrador_app':'anestesiologista'});store.seed('occupationalDosimetry',uid+'_2026',record(uid));}return{store,service:createDosimetryService({store})};}
test('ANR is never zero, blank months stay missing and decimal measurements preserve the report value',()=>{
 assert.deepEqual(dosimetryValue('ANR'),{kind:'CODE',display:'ANR',description:'Leitura abaixo do nível de registro',valueMsv:null});assert.equal(dosimetryValue(null).kind,'MISSING');assert.equal(dosimetryValue('0,2').valueMsv,0.2);assert.equal(dosimetryValue('0.2').display,'0,2');assert.equal(dosimetryValue('0,0').valueMsv,0);assert.equal(dosimetryMonths(record('one').values).length,12);
 for(const invalid of [undefined,'',0,-1,'-0.1','maybe','ANR <0.1',{},NaN])assert.throws(()=>dosimetryValue(invalid));assert.throws(()=>dosimetryMonths(Array(3).fill(null)));assert.throws(()=>validateDosimetryRecord({...record('one'),unit:'mGy'}));assert.equal(normalizeProfessionalName('Demonstração de Cadastro'),'DEMONSTRACAO CADASTRO');
});
test('every user and administrator receives only their prebound UID record; names and file links are not selectors',async()=>{
 const {store,service}=fixture();for(const uid of ['one','two','admin']){const result=await service.execute('GET_OWN',{year:2026},identity(uid));assert.equal(result.record.months[0].display,'ANR');for(const field of ['uid','email','sourceFileId','sourceFolderId','sourceFingerprint'])assert.equal(result.record[field],undefined);}
 for(const patch of [{uid:'two'},{email:identity('two').email},{name:sourceName},{sourceFileId:'other'},{year:2027}])await assert.rejects(service.execute('GET_OWN',{year:2026,...patch},identity('one')));
 await assert.rejects(service.execute('LIST',{year:2026},identity('admin')));
 store.seed('users','one',{...await store.get('users','one'),displayName:'Another person from a PDF'});assert.equal((await service.execute('GET_OWN',{year:2026},identity('one'))).record.sourceName,sourceName);
 store.seed('occupationalDosimetry','one_2026',{...record('two')});await assert.rejects(service.execute('GET_OWN',{year:2026},identity('one')),e=>e.code==='DOSIMETRY_RECORD_UNAVAILABLE');
});
test('unmatched records are empty, unverified/revoked accounts are denied and invalid data never becomes a dose',async()=>{
 const {store,service}=fixture();store.seed('users','new',{uid:'new',email:identity('new').email,active:true,access:true});assert.equal((await service.execute('GET_OWN',{year:2026},identity('new'))).record,null);
 for(const patch of [{emailVerified:false},{provider:'password'},{uid:'../one'}])await assert.rejects(service.execute('GET_OWN',{year:2026},{...identity('one'),...patch}));
 store.seed('users','one',{uid:'one',email:identity('one').email,active:true,access:false});await assert.rejects(service.execute('GET_OWN',{year:2026},identity('one')),e=>e.code==='DOSIMETRY_FORBIDDEN');
 store.seed('occupationalDosimetry','two_2026',{...record('two'),values:[]});await assert.rejects(service.execute('GET_OWN',{year:2026},identity('two')),e=>e.code==='DOSIMETRY_RECORD_UNAVAILABLE');
});
test('private import binds the exact official contact/email, rejects collisions and remains idempotent',()=>{
 const extraction={year:2026,sha256:'a'.repeat(64),fileId:'SYNTHETIC_PDF_FILE',folderId:'SYNTHETIC_FOLDER',quantity:'Hp(10)',unit:'mSv',issuedOn:'2026-04-13',extractionMethod:'rendered-pdf-visual-review',rows:[{code:'001',name:sourceName,months:record('one').values,monitorType:'28',monthsReported:2}]};
 const binding={uid:'one',email:identity('one').email,code:'001',sourceName,contactSigla:'XX',matchMethod:'official-contact-name-and-email'},contact={sigla:'XX',name:sourceName,email:identity('one').email};
 const input={extraction,pdfFingerprint:'a'.repeat(64),bindings:[binding],contacts:[contact],profiles:[{uid:'one',email:identity('one').email,active:true,access:true}]};
 const plan=buildDosimetryImportPlan(input);assert.equal(plan.summary.verifiedProfessionals,1);assert.equal(plan.documents[0].data.uid,'one');assert.equal(plan.documents[0].data.values[2],null);assert.equal(buildDosimetryImportPlan({...input,existing:[{id:'one_2026',...plan.documents[0].data}]}).summary.changes,0);
 for(const change of [{pdfFingerprint:'b'.repeat(64)},{bindings:[binding,binding]},{contacts:[{...contact,email:'other@example.invalid'}]},{profiles:[{uid:'one',email:'other@example.invalid',active:true,access:true}]}])assert.throws(()=>buildDosimetryImportPlan({...input,...change}));
});
test('dosimetry route uses the FB authentication key and stays disabled unless explicitly enabled',async()=>{
 const worker=createTrainingWorker({verifyIdentity:async(header,options)=>{assert.equal(options.apiKey,'fb-key');return identity('one');},buildDosimetryService:()=>({execute:async()=>({record:null})})});const request=()=>new Request('https://worker.test/v1/dosimetry',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify({action:'GET_OWN',input:{year:2026}})});
 assert.equal((await worker.fetch(request(),{})).status,503);const result=await worker.fetch(request(),{DOSIMETRY_ENABLED:'true',FB_WEB_API_KEY:'fb-key'});assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');
});

test('year selection reads only the authenticated year record and rejects a cross-year stored record',async()=>{
 const {store,service}=fixture();
 const historical={...record('one'),year:2025,issuedOn:'2026-01-23',values:['0,7',...Array(11).fill('ANR')]};
 store.seed('occupationalDosimetry','one_2025',historical);
 assert.equal((await service.execute('GET_OWN',{year:2025},identity('one'))).record.months[0].display,'0,7');
 assert.equal((await service.execute('GET_OWN',{year:2026},identity('one'))).record.months[0].display,'ANR');
 assert.equal((await service.execute('GET_OWN',{year:2025},identity('two'))).record,null);
 for(const year of [2024,2027,'2025',null])await assert.rejects(service.execute('GET_OWN',{year},identity('one')));
 store.seed('occupationalDosimetry','one_2025',record('one'));
 await assert.rejects(service.execute('GET_OWN',{year:2025},identity('one')),e=>e.code==='DOSIMETRY_RECORD_UNAVAILABLE');
});

test('historical imports are idempotent and never overwrite a different year',()=>{
 const extraction={year:2025,sha256:'a'.repeat(64),fileId:'SYNTHETIC_2025_PDF',folderId:'SYNTHETIC_FOLDER',quantity:'Hp(10)',unit:'mSv',issuedOn:'2026-01-23',extractionMethod:'rendered-pdf-visual-review',rows:[{code:'001',name:sourceName,months:Array(12).fill('ANR'),monitorType:'28',monthsReported:12}]};
 const input={extraction,pdfFingerprint:'a'.repeat(64),bindings:[{uid:'one',email:identity('one').email,code:'001',sourceName,contactSigla:'XX',matchMethod:'official-contact-name-and-email'}],contacts:[{sigla:'XX',name:sourceName,email:identity('one').email}],profiles:[{uid:'one',email:identity('one').email,active:true,access:true}],existing:[{id:'one_2026',...record('one')}]};
 const plan=buildDosimetryImportPlan(input);assert.equal(plan.documents[0].path,'occupationalDosimetry/one_2025');assert.equal(plan.documents[0].data.year,2025);assert.equal(plan.summary.changes,1);assert.equal(input.existing[0].year,2026);
 assert.equal(buildDosimetryImportPlan({...input,existing:[...input.existing,{id:'one_2025',...plan.documents[0].data}]}).summary.changes,0);
 for(const date of ['2026-02-30','2026-13-01'])assert.throws(()=>validateDosimetryRecord({...record('one'),issuedOn:date}));
});
