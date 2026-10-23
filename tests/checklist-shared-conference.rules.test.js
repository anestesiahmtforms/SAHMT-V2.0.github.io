import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, getDocFromServer, runTransaction, serverTimestamp, setDoc, updateDoc, deleteDoc, setLogLevel} from 'firebase/firestore';

let env;
setLogLevel('silent');
before(async()=>{
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
  env=await initializeTestEnvironment({projectId:'demo-sahmt-shared-checklist',firestore:{host:'127.0.0.1',
    port:Number(process.env.FIRESTORE_EMULATOR_HOST.split(':').pop()),rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
});
after(async()=>env?.cleanup());
const source=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');
function client(uid){
  const db=env.authenticatedContext(uid,{email_verified:true}).firestore();
  const body=source.slice(source.indexOf('function checklistAcknowledgementRequestId('),source.indexOf('function mergeWatchedRanges(')).replaceAll('export ','');
  const submit=new Function('db','doc','runTransaction','serverTimestamp',body+'\nreturn createChecklistSignatureRequest;')(db,doc,runTransaction,serverTimestamp);
  return {db,submit};
}
test('simultaneous preceptors share one immutable daily acknowledgement visible to every authorized viewer',async()=>{
  await env.clearFirestore();
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  await env.withSecurityRulesDisabled(async c=>{
    for(const [uid,sigla] of [['first','AA'],['second','BB'],['viewer','CC']])await setDoc(doc(c.firestore(),'users',uid),
      {uid,email:uid+'@example.invalid',displayName:'Synthetic '+uid,sigla,active:true,access:true,role:'usuario',permissions:{checklistRead:true,checklistSign:uid!=='viewer'}});
  });
  const first=client('first'),second=client('second'),viewer=client('viewer');
  const input=(uid,sigla)=>({day:date,uid,signerName:'Synthetic '+uid,signerSigla:sigla,revision:'a'.repeat(64),declaration:true,rotationSigla:'AA',rotationPosition:1});
  const results=await Promise.all([first.submit(input('first','AA')),second.submit(input('second','BB'))]);
  assert.equal(results[0].id,date);assert.equal(results[1].id,date);
  assert.equal(results[0].signerUid,results[1].signerUid);
  assert.equal(results[0].signerName,results[1].signerName);
  assert.equal(results.filter(r=>!r.alreadyRequested).length,1);
  const ref=doc(viewer.db,'checklistSignatureRequests',date);
  const saved=(await assertSucceeds(getDocFromServer(ref))).data();
  assert.equal(saved.signerUid,results[0].signerUid);
  assert.equal((await second.submit(input('second','BB'))).alreadyRequested,true);
  await assertFails(updateDoc(doc(first.db,'checklistSignatureRequests',date),{signerUid:'second'}));
  await assertFails(deleteDoc(doc(first.db,'checklistSignatureRequests',date)));
  for(const id of [date+'_first',date+'_'+'a'.repeat(64)+'_first']){
    await assertFails(setDoc(doc(first.db,'checklistSignatureRequests',id),{...saved,id,signerUid:'first',signerName:'Synthetic first',signerSigla:'AA',acknowledgedAt:serverTimestamp()}));
  }
  await env.withSecurityRulesDisabled(async c=>deleteDoc(doc(c.firestore(),'checklistSignatureRequests',date)));
  await assertFails(first.submit({...input('first','AA'),signerName:'Synthetic second'}));
  await assertFails(first.submit({...input('first','AA'),signerSigla:'BB'}));
  await assertFails(viewer.submit(input('viewer','CC')));
});
