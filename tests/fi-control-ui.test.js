import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFiControl,renderFiResults} from '../src/fi-control-ui.js';
test('control center keeps administrative commands out of ordinary user view',()=>{
 const delegated={displayName:'<img src=x>',permissions:{peopleManage:true,usersManage:true}};
 const denied=renderFiControl({profile:delegated});assert.match(denied,/Acesso reservado/);assert.doesNotMatch(denied,/data-fi-monthly|data-fi-nav="people"|Pesquisar no app/);
 const plain=renderFiControl({profile:delegated,searchOnly:true});assert.doesNotMatch(plain,/data-fi-monthly|data-fi-nav="fi-control"/);assert.ok(!plain.includes('<img src=x>'));assert.ok(plain.includes('Pesquisar no app'));
 const adminSearch=renderFiControl({profile:{role:'administrador_app'},searchOnly:true});
 assert.doesNotMatch(adminSearch,/data-fi-nav="fi-control"/);
 assert.doesNotMatch(adminSearch,/data-fi-monthly/);
 const admin=renderFiControl({profile:{permissions:{admin:true}}});assert.ok(admin.includes('data-fi-monthly'));assert.ok(admin.includes('data-fi-nav="people"'));
 assert.doesNotMatch(admin,/data-fi-search/);
});
test('search view escapes source text and rejects external or script links',()=>{
 const result=renderFiResults({results:[{id:'1',title:'<script>bad</script>',snippet:'<img>',url:'javascript:alert(1)'},{id:'2',title:'Doc',snippet:'Descrição',url:'#/management'}],ai:{status:'disabled'}});
 assert.ok(!result.includes('<script>'));assert.ok(!result.includes('javascript:'));assert.ok(result.includes('href="#/management"'));
});
test('empty search distinguishes an unavailable source from no permitted matches',()=>{
 assert.match(renderFiResults({results:[]}),/materiais disponíveis para sua conta/);
 const partial=renderFiResults({results:[],coverage:[{source:'FB.scopedDocuments',status:'UNAVAILABLE',detail:'Uma fonte atingiu o limite diário de consulta.'}]});
 assert.match(partial,/Não houve resultados nas fontes consultadas/);
 assert.match(partial,/limite diário/);
 assert.doesNotMatch(partial,/materiais disponíveis para sua conta/);
});
test('personal schedule answers use a validated link to the selected date',()=>{
 const result=renderFiResults({schedule:{status:'found',day:'2026-12-12',positions:[2]}});
 assert.match(result,/Sua posição na escala de 12\/12\/2026 é 2/);
 assert.match(result,/href="#\/schedule\/2026-12-12"/);
 const missing=renderFiResults({schedule:{status:'not_assigned',day:'2026-12-12'}});
 assert.match(missing,/Sua sigla não aparece/);
 const unlinked=renderFiResults({schedule:{status:'identity_unlinked'}});
 assert.match(unlinked,/sigla ativa vinculada/);
 assert.doesNotMatch(unlinked,/href=/);
});
test('search shows the total and reveals later matches from the same response',()=>{
 const results=Array.from({length:23},(_,i)=>({id:String(i),source:'FB',title:'Material '+(i+1),snippet:'Trecho'}));
 const first=renderFiResults({results,totalMatches:23});
 assert.match(first,/Exibindo 20 de 23/);
 assert.match(first,/data-fi-more/);
 assert.doesNotMatch(first,/Material 21</);
 const more=renderFiResults({results,totalMatches:23},40);
 assert.match(more,/Exibindo 23 de 23/);
 assert.match(more,/Material 23</);
 assert.doesNotMatch(more,/data-fi-more/);
});
