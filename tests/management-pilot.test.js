import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {canUseManagementPilot} from '../src/management-pilot.js';
const pilot=()=>({status:'signed-in',user:{uid:'synthetic',email:'wx2901@gmail.com',emailVerified:true},profile:{uid:'synthetic',email:'wx2901@gmail.com',active:true,access:true,role:'temporario',permissions:{}}});
test('pilot requires the verified account, matching profile, and active approved session',()=>{
 assert.equal(canUseManagementPilot(pilot()),true);
 for(const change of [s=>s.user.email='other@example.test',s=>s.user.emailVerified=false,s=>s.profile.email='other@example.test',s=>s.profile.uid='other',s=>s.profile.active=false,s=>s.profile.access=false,s=>s.status='auth-limited']){const s=pilot();change(s);assert.equal(canUseManagementPilot(s),false);}
 const admin=pilot();admin.user.email='owner@example.test';admin.profile.role='administrador_app';assert.equal(canUseManagementPilot(admin),true);admin.profile.active=false;assert.equal(canUseManagementPilot(admin),false);
});
function hub(access={},initialPanel='home'){
 const handlers={},heading={focus(){}},body={innerHTML:'',scrollTop:0,addEventListener:(n,fn)=>handlers[n]=fn},back={addEventListener(){}},dialog={dataset:{},querySelector:s=>s==='[data-hub-body]'?body:s==='[data-hub-back]'?back:s==='#management-hub-title'?heading:{},addEventListener(){},showModal(){}},root={querySelector:()=>dialog};
 const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../src/management-hub.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace(/^export /gm,''),ctx);ctx.mountManagementHub(root,{access,initialPanel,onExit(){},onNavigate(){}});return {dialog,body,handlers};
}
test('common users see all five disabled buttons; deep links cannot open paused subpanels',()=>{
 for(const initialPanel of ['home','records','indicators','results','surveys']){const h=hub({},initialPanel);assert.equal(h.dialog.dataset.panel,'home');assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,5);assert.equal((h.body.innerHTML.match(/ disabled /g)||[]).length,5);}
 const h=hub({groups:true,performance:true,records:true,results:true,surveys:true,qmentum:true});assert.doesNotMatch(h.body.innerHTML,/ disabled /);
});
