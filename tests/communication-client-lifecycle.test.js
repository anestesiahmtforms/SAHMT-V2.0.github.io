import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('communication recovery returns to FA without another Google widget or request',async()=>{
 let removed=0,requests=0,link;
 const document={visibilityState:'visible',addEventListener(){},removeEventListener(){},createElement:()=>({remove(){removed++;}})};
 const context=vm.createContext({document,env:{VITE_COMMUNICATION_FF_ENABLED:'true'},fetch:()=>{requests++;throw Error('unexpected request');}});
 const source=readFileSync(new URL('../src/communication-client.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env');
 vm.runInContext(source,context);const client=context.createCommunicationClient();
 const cleanup=await client.connectGoogle({isConnected:true,replaceChildren(value){link=value;}},{});
 assert.equal(link.href,'#/offline');assert.equal(requests,0);cleanup();assert.equal(removed,1);client.dispose();
});

test('disabled communication refuses reads before token exchange or transport',async()=>{let requests=0;const context=vm.createContext({document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},operationalContentAllowed:()=>false,env:{VITE_COMMUNICATION_FF_ENABLED:'true'},fail:code=>Object.assign(Error(code),{code}),fetch:()=>{requests++;throw Error('unexpected request');}});const source=readFileSync(new URL('../src/communication-client.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env');vm.runInContext(source,context);const client=context.createCommunicationClient();await assert.rejects(client.request('INBOX'),{code:'COMM_CONFIG_REQUIRED'});assert.equal(requests,0);client.dispose();});
