import test from 'node:test';import assert from 'node:assert/strict';
import {bindSurveySession,requestSurveySession,SURVEY_APP_ORIGIN,SURVEY_FE_ORIGIN} from '../src/survey-session-bridge.js';
const target=()=>{const listeners=new Set();return {addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);},emit(e){return Promise.all([...listeners].map(fn=>fn(e)));},get size(){return listeners.size;}};};
test('bridge pins both origins and window references; no identity crosses the boundary',async()=>{
 const host=target(),child=target(),messages=[],frame={contentWindow:{postMessage:(body,origin)=>messages.push({body,origin})}};let calls=0,current=true;
 const cleanup=bindSurveySession(frame,{appWindow:host,isCurrent:()=>current,perform:async()=>{calls++;return {group:'team',alreadyResponded:false};}});
 const data={type:'SAHMT_SURVEY_REQUEST_V1',challenge:'a'.repeat(32),action:'BOOTSTRAP',input:null};
 for(const event of [{origin:'https://evil.invalid',source:frame.contentWindow,data},{origin:SURVEY_FE_ORIGIN,source:child,data},{origin:SURVEY_FE_ORIGIN,source:frame.contentWindow,data:{...data,uid:'forbidden'}}])await host.emit(event);
 assert.equal(calls,0);await host.emit({origin:SURVEY_FE_ORIGIN,source:frame.contentWindow,data});assert.equal(calls,1);assert.equal(messages.length,1);assert.deepEqual(Object.keys(messages[0].body).sort(),['challenge','result','type']);assert.deepEqual(messages[0].body.result,{group:'team',alreadyResponded:false});assert.equal(messages[0].origin,SURVEY_FE_ORIGIN);
 await host.emit({origin:SURVEY_FE_ORIGIN,source:frame.contentWindow,data});assert.equal(calls,1);
 current=false;await host.emit({origin:SURVEY_FE_ORIGIN,source:frame.contentWindow,data:{...data,challenge:'b'.repeat(32)}});assert.equal(calls,1);cleanup();assert.equal(host.size,0);
});
test('child accepts only the expected parent and challenge; direct external access cannot bypass app login',async()=>{
 const child=target(),sent=[];child.parent={postMessage:(body,origin)=>sent.push({body,origin})};
 const pending=requestSurveySession({action:'BOOTSTRAP',appWindow:child,timeoutMs:100});const request=sent[0];assert.equal(request.origin,SURVEY_APP_ORIGIN);assert.deepEqual(Object.keys(request.body).sort(),['action','challenge','input','type']);
 const data={type:'SAHMT_SURVEY_REPLY_V1',challenge:request.body.challenge,result:{group:'resident',alreadyResponded:false}};
 await child.emit({origin:'https://evil.invalid',source:child.parent,data});assert.equal(child.size,1);await child.emit({origin:SURVEY_APP_ORIGIN,source:{},data});assert.equal(child.size,1);await child.emit({origin:SURVEY_APP_ORIGIN,source:child.parent,data:{...data,challenge:'0'.repeat(32)}});assert.equal(child.size,1);
 await child.emit({origin:SURVEY_APP_ORIGIN,source:child.parent,data});assert.deepEqual(await pending,{group:'resident',alreadyResponded:false});assert.equal(child.size,0);
 const direct=target();direct.parent=direct;await assert.rejects(requestSurveySession({action:'BOOTSTRAP',appWindow:direct}),/OPEN_FROM_APP/);
});
