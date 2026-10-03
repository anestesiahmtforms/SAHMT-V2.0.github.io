import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGoogleFormLink,extractGoogleFormLinks,reconcileFormLinkReferences} from '../src/form-links.js';
const form='RealFormId123456';
test('IDs editáveis e aliases públicos/curtos permanecem distintos',()=>{
  const edit=normalizeGoogleFormLink(`https://docs.google.com/forms/u/2/d/${form}/edit?usp=sharing#x`);
  assert.equal(edit.formId,form);assert.equal(edit.aliasKey,`form:${form}`);
  const pub=normalizeGoogleFormLink('https://docs.google.com/forms/d/e/PublishedAlias123456/viewform?embedded=true');
  assert.equal(pub.formId,null);assert.equal(pub.kind,'RESPONDER_ID');
  assert.equal(normalizeGoogleFormLink('https://forms.gle/Abcd1234').kind,'SHORT_URL');
});
test('origens inválidas, HTTP, credenciais e hosts parecidos são rejeitados',()=>{
  for(const url of ['http://forms.gle/Abcd1234','https://docs.google.com.evil.invalid/forms/d/RealFormId123456/edit','https://user:password@docs.google.com/forms/d/RealFormId123456/edit','https://docs.google.com/document/d/RealFormId123456/edit','https://forms.gle/'])assert.equal(normalizeGoogleFormLink(url),null);
});
test('detecção percorre conteúdos/links futuros e deduplica sem hardcodes de área',()=>{
  const data={futureArea:{content:[`Veja (https://docs.google.com/forms/d/${form}/edit).`,{link:`https://docs.google.com/forms/d/${form}/edit?x=1`},'https://forms.gle/Abcd1234']}};data.self=data;
  assert.equal(extractGoogleFormLinks(data).length,2);
});
test('remoção é lógica e preserva histórico/configuração; origem incompleta mantém vínculos',()=>{
  const old={sourceCollection:'managementAreas',sourceId:'future-area',aliasKey:`form:${form}`,formId:form,active:true,status:'READY',history:['preserved']};
  const removed=reconcileFormLinkReferences([old],[])[0];assert.equal(removed.active,false);assert.deepEqual(removed.history,['preserved']);assert.equal(removed.status,'INACTIVE');
  assert.deepEqual(reconcileFormLinkReferences([old],[],{complete:false}),[old]);
  const fresh=reconcileFormLinkReferences([],[{...old,status:undefined}])[0];assert.equal(fresh.status,'CONFIGURATION_PENDING');
});
