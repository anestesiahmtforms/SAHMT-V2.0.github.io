import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTrainingDocumentCard} from '../src/html-training-card.js';

const training = {id:'protocol-1',title:'Protocolo institucional',status:'PUBLISHED',category:'Protocolos',sectionCount:3};
test('the document title is the only opening button and keeps the authorized training ID', () => {
  const html = renderTrainingDocumentCard(training);
  assert.match(html, /<h3><button[^>]*data-ht="open" data-id="protocol-1" aria-label="Protocolo institucional"/);
  assert.match(html, /class="ht-document-title">Protocolo institucional/);
  assert.equal((html.match(/data-ht="open"/g) || []).length,1);
  assert.doesNotMatch(html, /Abrir treinamento|data-ht="edit"/);
});
test('drafts cannot be opened and editing remains an independent manager action', () => {
  const html = renderTrainingDocumentCard({...training,status:'DRAFT'},{canManage:true});
  assert.doesNotMatch(html, /data-ht="open"/);
  assert.match(html, /class="ht-document-folder"[^>]* disabled/);
  assert.match(html, /data-ht="edit" data-id="protocol-1"/);
  assert.match(html, /Rascunho · aguardando publicação/);
});
test('document titles, IDs and category metadata cannot inject markup or attributes', () => {
  const html = renderTrainingDocumentCard({...training,id:'x" onclick="bad()',title:'<img src=x onerror=bad()>',category:'<script>bad()</script>',subcategory:'"unsafe"'});
  assert.doesNotMatch(html, /<img|<script|" onclick=/);
  assert.match(html, /data-id="x&quot; onclick=&quot;bad\(\)"/);
  assert.match(html, /&lt;img src=x onerror=bad\(\)&gt;/);
});
