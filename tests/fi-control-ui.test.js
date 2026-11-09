import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFiControl,renderFiResults} from '../src/fi-control-ui.js';
test('control center keeps administrative commands out of ordinary user view',()=>{
 const delegated={displayName:'<img src=x>',permissions:{peopleManage:true,usersManage:true}};
 const denied=renderFiControl({profile:delegated});assert.match(denied,/Acesso reservado/);assert.doesNotMatch(denied,/data-fi-monthly|data-fi-nav="people"|Pesquisar no app/);
 const plain=renderFiControl({profile:delegated,searchOnly:true});assert.ok(!plain.includes('data-fi-monthly'));assert.ok(!plain.includes('<img src=x>'));assert.ok(plain.includes('Pesquisar no app'));
 const admin=renderFiControl({profile:{permissions:{admin:true}}});assert.ok(admin.includes('data-fi-monthly'));assert.ok(admin.includes('data-fi-nav="people"'));
 assert.doesNotMatch(admin,/data-fi-search/);
});
test('search view escapes source text and rejects external or script links',()=>{
 const result=renderFiResults({results:[{id:'1',title:'<script>bad</script>',snippet:'<img>',url:'javascript:alert(1)'},{id:'2',title:'Doc',snippet:'Descrição',url:'#/management'}],ai:{status:'disabled'}});
 assert.ok(!result.includes('<script>'));assert.ok(!result.includes('javascript:'));assert.ok(result.includes('href="#/management"'));
});
