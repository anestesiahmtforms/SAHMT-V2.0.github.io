import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberModuleNavigation, consumeModuleNavigation} from '../src/module-navigation.js';
const FA='/SAHMT-V2.0.github.io/',FB=FA+'gestao/';
const fixture=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('a same-tab app switch consumes the animation hint once',()=>{
 const storage=fixture();assert.equal(rememberModuleNavigation(FB,{storage,pathname:FA,now:1000}),true);
 assert.equal(consumeModuleNavigation({storage,pathname:FB,now:1100}),true);
 assert.equal(consumeModuleNavigation({storage,pathname:FB,now:1200}),false);
 assert.equal(rememberModuleNavigation(FA,{storage,pathname:FB,now:2000}),true);
 assert.equal(consumeModuleNavigation({storage,pathname:FA,now:2100}),true);
});
test('cold launch, stale, future and wrong destination hints retain the opening animation',()=>{
 for(const [pathname,now] of [[FA,1100],[FB,32000],[FB,900]]){
  const storage=fixture();rememberModuleNavigation(FB,{storage,pathname:FA,now:1000});assert.equal(consumeModuleNavigation({storage,pathname,now}),false);
 }
 assert.equal(consumeModuleNavigation({storage:fixture(),pathname:FA,now:1000}),false);
});
test('same-app routes and unrecognized paths cannot create a module handoff',()=>{
 const storage=fixture();for(const target of [FA,'https://example.com/',FA+'tools/'])assert.equal(rememberModuleNavigation(target,{storage,pathname:FA,now:1}),false);
});
test('unavailable browser storage cannot break navigation',()=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.equal(rememberModuleNavigation(FB,{storage,pathname:FA}),false);assert.equal(consumeModuleNavigation({storage,pathname:FB}),false);
});
