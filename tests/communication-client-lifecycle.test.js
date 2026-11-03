import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('backgrounding during Google loading preserves the recovery widget without starting requests',async()=>{
 let release,rendered=0,disposed=0,requests=0;
 const loading=new Promise(resolve=>release=resolve),doc={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const context=vm.createContext({document:doc,googleProjectClientId:'synthetic-client',currentGoogleProjectIdentity:()=>({uid:'fa-person',googleUid:'google-person'}),env:{VITE_COMMUNICATION_FF_ENABLED:'true'},mockGoogleButton:()=>({render:async()=>{await loading;rendered++;},dispose:()=>disposed++}),fetch:()=>{requests++;throw Error('Unexpected request');}});
 const source=readFileSync(new URL('../src/communication-client.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env').replace("await import('./google-project-auth-google-button.js')",'await Promise.resolve({createGoogleProjectAuthGoogleButton:mockGoogleButton})');
 vm.runInContext(source,context);const client=context.createCommunicationClient(),connecting=client.connectGoogle({isConnected:true},{onConnected(){},onError(){}});
 await Promise.resolve();doc.visibilityState='hidden';release();const cleanup=await connecting;
 assert.equal(rendered,1);assert.equal(disposed,0);assert.equal(requests,0);doc.visibilityState='visible';cleanup();assert.equal(disposed,1);client.dispose();
});
