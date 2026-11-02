import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=main.indexOf("  if (!authLimited && ['occurrences','qmentum','fa-performance','fc-performance','fd-performance','fe-performance'].includes(requestedRoute))");
assert.ok(start>=0,'FC module footer lifecycle must be present');
const code=main.slice(start,main.indexOf('  if(!authLimited)preloadOperationalDataWhenIdle',start));
test('FA performance footer returns to Checklist',()=>{
 const calls=[],events=new Map(),button={textContent:'Home',removeAttribute(){},addEventListener:(name,fn)=>events.set(name,fn)};
 vm.runInNewContext(code,{authLimited:false,requestedRoute:'fa-performance',app:{querySelectorAll:()=>[button]},navigate:(...args)=>calls.push(args)});events.get('click')();assert.equal(calls[0][0],'checklist');
});
test('Governance module footers return to their immediate parent',()=>{
 for(const requestedRoute of ['occurrences','qmentum','fc-performance','fd-performance']){
  const calls=[],events=new Map(),button={textContent:'Home',removeAttribute(){},addEventListener:(name,fn)=>events.set(name,fn)};
  vm.runInNewContext(code,{authLimited:false,requestedRoute,app:{querySelectorAll:()=>[button]},navigate:(...args)=>calls.push(args)});
  assert.equal(button.textContent,'VOLTAR');events.get('click')();assert.equal(calls[0][0],'management-hub');assert.equal(calls[0][1].panel,'records');
 }
});
test('FB Home navigation targets the main FA entry rather than the Governance dialog',async()=>{
 const source=readFileSync(new URL('../src/router.js',import.meta.url),'utf8'),calls=[];
 const ctx=vm.createContext({deployment:{target:'FB',faBase:'/SAHMT-V2.0.github.io/'},location:{hash:'#/management',assign:url=>calls.push(url)},rememberModuleNavigation(){}});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),ctx);await ctx.navigate('home');
 assert.deepEqual(calls,['/SAHMT-V2.0.github.io/#/home']);
});

test('FB Management back targets Governance in FA',async()=>{
 const source=readFileSync(new URL('../src/router.js',import.meta.url),'utf8'),calls=[];
 const ctx=vm.createContext({deployment:{target:'FB',faBase:'/SAHMT-V2.0.github.io/'},location:{hash:'#/management',assign:url=>calls.push(url)},rememberModuleNavigation(){}});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),ctx);await ctx.navigate('management-hub');
 assert.deepEqual(calls,['/SAHMT-V2.0.github.io/#/management-hub']);
});
