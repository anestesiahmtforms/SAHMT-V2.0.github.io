import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script-management-gateway/Gateway.gs',import.meta.url),'utf8');
function harness({areas=[{id:'synthetic-area',active:true,memberUids:['member'],managerUids:[]}],acl={id:'member@example.invalid',email:'member@example.invalid',active:true,groups:['GENERAL']},missing=false}={}) {
 const c=vm.createContext({console:{log(){throw Error('logging forbidden');}}});vm.runInContext(source,c);
 const encode=x=>c.mgwFieldsEncode_(JSON.parse(JSON.stringify(x)));const calls=[];
 const invoke=(method,path,payload)=>{calls.push({method,path,payload});
 if(method==='post')return {data:areas.length?areas.map(a=>({document:{name:'projects/sahmt-gestao-5ae66/databases/(default)/documents/managementAreas/'+a.id,fields:encode({active:a.active,memberUids:a.memberUids,managerUids:a.managerUids}),updateTime:'2026-10-14T12:00:00.000Z'}})):[{readTime:'2026-10-14T12:00:00.000Z'}]};
 return missing?{missing:true}:{data:{name:'projects/sahmt-17a16/databases/(default)/documents/documentAccessEmails/member@example.invalid',fields:encode(acl)}};
 };return {c,calls,run:()=>c.mgwManagementDomainContext_('member','google-sub','member@example.invalid',invoke)};
}
test('trusted FB relations and FA ACL produce only identity-bound groups',()=>{
 const h=harness(),r=h.run();assert.equal(r.areas[0].id,'synthetic-area');assert.equal(r.documentAccess.googleUid,'google-sub');
 assert.deepEqual([...r.documentAccess.groups],['GENERAL']);assert.equal(h.calls[0].payload.structuredQuery.limit,26);
 assert.equal(h.calls.length,2);assert.ok(h.calls[0].path.includes('sahmt-gestao-5ae66'));assert.ok(h.calls[1].path.includes('sahmt-17a16'));
 assert.equal(JSON.stringify(r).includes('member@example.invalid'),false);
});
test('missing or inactive ACL gives no document audience',()=>{
 for(const options of [{areas:[],missing:true},{acl:{id:'member@example.invalid',email:'member@example.invalid',active:false,groups:['GENERAL']}}]){
 const r=harness(options).run();assert.equal(r.documentAccess.active,false);assert.equal(r.documentAccess.groups.length,0);
 }
});
test('ambiguous or excessive area coverage fails closed before ACL read',()=>{
 for(const areas of [Array.from({length:26},(_,i)=>({id:'area-'+i,active:true,memberUids:['member'],managerUids:[]})),
 [{id:'a',active:true,memberUids:['other'],managerUids:[]}],
 [{id:'a',active:true,memberUids:['member'],managerUids:[]},{id:'a',active:true,memberUids:['member'],managerUids:[]}]]){
 const h=harness({areas});assert.throws(h.run);assert.equal(h.calls.length,1);
 }
});
test('mismatched email and unrecognized or duplicate groups never authorize',()=>{
 for(const patch of [{email:'other@example.invalid'},{id:'other@example.invalid'},{groups:['ADMIN']},{groups:['GENERAL','GENERAL']},{active:'true'}])
 assert.throws(harness({acl:{id:'member@example.invalid',email:'member@example.invalid',active:true,groups:['GENERAL'],...patch}}).run);
});
test('optional signed domain field permits true only on FA authorization operation',()=>{
 const h=harness(),config={};h.c.mgwDataBody_('READ_FA_AUTHORIZATION',{uid:'member',projectId:'sahmt-17a16',includeManagementDomain:true},config,1);
 for(const value of [false,'true',null])assert.throws(()=>h.c.mgwDataBody_('READ_FA_AUTHORIZATION',{uid:'member',projectId:'sahmt-17a16',includeManagementDomain:value},config,1));
 assert.throws(()=>h.c.mgwDataBody_('READ_FB_LEASE',{uid:'member',projectId:'sahmt-gestao-5ae66',includeManagementDomain:true},config,1));
});
