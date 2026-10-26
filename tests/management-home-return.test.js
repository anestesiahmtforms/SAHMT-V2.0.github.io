import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=main.indexOf("  if (!authLimited && ['management','training','occurrences','qmentum'].includes(requestedRoute))");
const code=main.slice(start,main.indexOf('  if(!authLimited)preloadOperationalDataWhenIdle',start));
test('the former Governance return button opens Home in each affected module',()=>{
 for(const requestedRoute of ['management','training','occurrences','qmentum']){
  const calls=[],events=new Map(),button={textContent:'Home',removeAttribute(){},addEventListener:(name,fn)=>events.set(name,fn)};
  vm.runInNewContext(code,{authLimited:false,requestedRoute,app:{querySelectorAll:()=>[button]},navigate:(...args)=>calls.push(args)});
  assert.equal(button.textContent,'HOME');events.get('click')();assert.deepEqual(calls,[['home']]);
 }
});
test('FB Home navigation targets the main FA entry rather than the Governance dialog',async()=>{
 const source=readFileSync(new URL('../src/router.js',import.meta.url),'utf8'),calls=[];
 const ctx=vm.createContext({deployment:{target:'FB',faBase:'/SAHMT-V2.0.github.io/'},location:{hash:'#/management',assign:url=>calls.push(url)},rememberModuleNavigation(){}});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),ctx);await ctx.navigate('home');
 assert.deepEqual(calls,['/SAHMT-V2.0.github.io/#/home']);
});
