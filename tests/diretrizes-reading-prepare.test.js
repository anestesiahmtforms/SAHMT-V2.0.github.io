import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareReadingPolicy} from '../scripts/prepare-diretrizes-reading.mjs';
test('private compiler derives page count and checksum without inventing IDs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reading-test-'));
 try{
  const filePath=join(dir,'fixture.pdf');await writeFile(filePath,'%PDF-synthetic');
  const entry={documentId:'evaluation_FormFixture123456',formId:'FormFixture123456',pdfId:'PdfFixture1234567',filePath,version:1};
  const loadPdf=()=>({promise:Promise.resolve({numPages:2}),destroy:async()=>{}});
  const result=await prepareReadingPolicy({entries:[entry],pilotUids:['reader']},{loadPdf});
  assert.equal(result.report.remoteWrites,0);assert.equal(result.report.documents,1);assert.equal(result.policy.documents[entry.documentId].enforced,false);
  assert.match(result.policy.documents[entry.documentId].checksum,/^[a-f0-9]{32}$/);
  await assert.rejects(prepareReadingPolicy({entries:[entry,entry],pilotUids:['reader']},{loadPdf}));
  await assert.rejects(prepareReadingPolicy({entries:[{...entry,expectedChecksum:'f'.repeat(32)}],pilotUids:['reader']},{loadPdf}));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('compiler supports trusted reader-only bindings and category/audience without creating Forms',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reading-test-'));try{
 const filePath=join(dir,'fixture.pdf');await writeFile(filePath,'%PDF-synthetic');const loadPdf=()=>({promise:Promise.resolve({numPages:2}),destroy:async()=>{}});
 const entry={documentId:'administrative_original',formId:null,sourceFileId:'OriginalFixture12345',pdfDocumentId:'administrative_pdf',pdfId:'PdfFixture1234567',category:'Documentos administrativos',audienceGroup:'RESTRICTED',filePath,version:1};
 const result=await prepareReadingPolicy({entries:[entry],pilotUids:['reader']},{loadPdf});assert.equal(result.policy.documents[entry.documentId].formId,null);assert.equal(result.policy.documents[entry.documentId].audienceGroup,'RESTRICTED');assert.equal(result.report.remoteWrites,0);
 await assert.rejects(prepareReadingPolicy({entries:[{...entry,audienceGroup:'ADMIN'}],pilotUids:['reader']},{loadPdf}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
