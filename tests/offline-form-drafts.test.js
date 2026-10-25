import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {installOperationalDrafts} from '../src/offline-form-drafts.js';
import {readOperationalDraft} from '../src/outbox.js';
test('confirmação de formulário anterior nunca remove um rascunho novo ou de outra conta', async () => {
  const handlers = new Map(), session = {status: 'signed-in', user: {uid: 'draft-submit-a'}, profile: {active: true, access: true, permissions: {eventsWrite: true}}};
  const drafts = installOperationalDrafts({root: {addEventListener: (name, fn) => handlers.set(name, fn)}, getSession: () => session});
  const input = {name: 'description', type: 'text', value: 'Registro inicial'}, form = {dataset: {moduleForm: 'events'}, elements: [input]};
  const change = () => handlers.get('input')({target: {closest: () => form, type: 'text'}});
  change(); const checkpoint = drafts.checkpoint(form);
  input.value = 'Novo registro'; change(); await drafts.clearSubmitted(checkpoint); await drafts.flush();
  assert.equal((await readOperationalDraft('draft-submit-a', 'events', 'entry')).fields.description, 'Novo registro');
  const latest = drafts.checkpoint(form); session.user.uid = 'draft-submit-b'; input.value = 'Outra conta'; change();
  await drafts.clearSubmitted(latest); await drafts.flush();
  assert.equal((await readOperationalDraft('draft-submit-b', 'events', 'entry')).fields.description, 'Outra conta');
});

test('retorno rápido ao formulário recupera a última captura mesmo com gravações ainda na fila',async()=>{
  const handlers=new Map(),session={status:'signed-in',user:{uid:'draft-rapid-return'},profile:{active:true,access:true,permissions:{eventsWrite:true}}};
  const drafts=installOperationalDrafts({root:{addEventListener:(name,fn)=>handlers.set(name,fn)},getSession:()=>session});
  const input={name:'description',type:'text',value:''},oldForm={dataset:{moduleForm:'events'},elements:[input]};
  for(let i=1;i<=8;i++){input.value='Revisão '+i;handlers.get('input')({target:{closest:()=>oldForm,type:'text'}});}
  const restored={name:'description',type:'text',value:''},elements=[restored];elements.namedItem=()=>restored;
  const form={dataset:{moduleForm:'events'},elements,isConnected:true,querySelectorAll:()=>[],querySelector:()=>({textContent:''})};
  await drafts.restore(form);
  await drafts.flush();
  assert.equal(restored.value,'Revisão 8');
});
