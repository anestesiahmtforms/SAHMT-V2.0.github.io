import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {canUseManagementPilot} from '../src/management-pilot.js';
const pilot=()=>({status:'signed-in',user:{uid:'synthetic',email:'wx2901@gmail.com',emailVerified:true},profile:{uid:'synthetic',email:'wx2901@gmail.com',active:true,access:true,role:'temporario',permissions:{}}});
test('pilot requires the verified account, matching profile, and active approved session',()=>{
 assert.equal(canUseManagementPilot(pilot()),true);
 for(const change of [s=>s.user.email='other@example.test',s=>s.user.emailVerified=false,s=>s.profile.email='other@example.test',s=>s.profile.uid='other',s=>s.profile.active=false,s=>s.profile.access=false,s=>s.status='auth-limited']){const s=pilot();change(s);assert.equal(canUseManagementPilot(s),false);}
 const admin=pilot();admin.user.email='owner@example.test';admin.profile.role='administrador_app';assert.equal(canUseManagementPilot(admin),true);admin.profile.active=false;assert.equal(canUseManagementPilot(admin),false);
});
function hub(access={},initialPanel='home',syncStatusElement=null,climateEnabled=false){
 const syncHost={append(element){this.child=element;}},handlers={},heading={focus(){}},headingIcon={innerHTML:''},body={innerHTML:'',scrollTop:0,addEventListener:(n,fn)=>handlers[n]=fn},back={addEventListener:(n,fn)=>handlers['back-'+n]=fn},dialog={dataset:{},querySelector:s=>s==='[data-hub-sync]'?syncHost:s==='[data-hub-body]'?body:s==='[data-hub-back]'?back:s==='#management-hub-title'?heading:s==='[data-hub-heading-icon]'?headingIcon:{},addEventListener(){},showModal(){}},root={querySelector:()=>dialog};
 const navigations=[],ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../src/management-hub.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace(/^export /gm,''),ctx);ctx.mountManagementHub(root,{access,initialPanel,syncStatusElement,climateEnabled,onExit(){navigations.push('home');},onNavigate:route=>navigations.push(route)});return {dialog,body,handlers,navigations,heading,headingIcon,root,back,syncHost};
}
test('FA survey entry shares the app origin without session parameters, opener or referrer',()=>{
 const released=hub({surveys:true},'institutional',null,true);assert.match(released.body.innerHTML,/href="\/SAHMT-V2\.0\.github\.io\/enquetes\/"/);assert.match(released.body.innerHTML,/rel="noopener noreferrer" referrerpolicy="no-referrer"/);assert.match(released.body.innerHTML,/PESQUISA DE CLIMA ORGANIZACIONAL/);
 assert.doesNotMatch(hub({surveys:true},'institutional',null,false).body.innerHTML,/href=/);
 assert.match(released.body.innerHTML,/href="\/SAHMT-V2\.0\.github\.io\/enquetes\/stress\.html"/);assert.match(released.body.innerHTML,/AVALIAÇÃO DE ESTRESSE E FADIGA/);
});
test('common users see all five disabled buttons; deep links cannot open paused subpanels',()=>{
 for(const initialPanel of ['home','records','indicators','results','surveys','institutional']){const h=hub({},initialPanel);assert.equal(h.dialog.dataset.panel,'home');assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,5);assert.equal((h.body.innerHTML.match(/ disabled /g)||[]).length,5);}
 const h=hub({groups:true,performance:true,records:true,results:true,surveys:true,qmentum:true});assert.doesNotMatch(h.body.innerHTML,/ disabled /);
});
test('Governança header uses the existing Diamond seal while retaining all five destinations',()=>{
 const h=hub({groups:true,performance:true,records:true,results:true,surveys:true,qmentum:true});assert.equal(h.heading.textContent,'Governança');assert.ok(h.root.innerHTML.includes('</header><div class="management-hub-content-panel">'));assert.match(h.headingIcon.innerHTML,/img[^>]+selo-qga-accredited-qmentum-diamond\.png[^>]+alt="Diamond Qmentum"/);assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,5);
});
test('Registro de Indicadores opens QMENTUM directly and the old folder link returns to Registros',()=>{
 const h=hub({records:true,qmentum:true},'indicators');assert.equal(h.dialog.dataset.panel,'records');assert.match(h.body.innerHTML,/Registro de Indicadores/);assert.doesNotMatch(h.body.innerHTML,/Indicadores Qmentum/);
 h.handlers.click({target:{closest:()=>({disabled:false,dataset:{hubItem:'1'}})}});assert.deepEqual(h.navigations,['qmentum']);
 const paused=hub({records:true},'records');paused.handlers.click({target:{closest:()=>({disabled:false,dataset:{hubItem:'1'}})}});assert.deepEqual(paused.navigations,[]);
});

test('Governance HOME exits to the main home; a subpanel returns one level first',()=>{
 const h=hub({records:true},'records');assert.equal(h.back.textContent,'VOLTAR');h.handlers['back-click']();
 assert.equal(h.dialog.dataset.panel,'home');assert.equal(h.back.textContent,'HOME');assert.deepEqual(h.navigations,[]);
 h.handlers['back-click']();assert.deepEqual(h.navigations,['home']);
});

test('Governance keeps the live synchronization control visible in its modal header and subpanels',()=>{
 const syncStatusElement={id:'outbox-status',innerHTML:'<button>OFFLINE — OPERANDO LOCALMENTE</button>'};
 const h=hub({records:true},'home',syncStatusElement);
 assert.equal(h.syncHost.child,syncStatusElement);
 assert.match(h.root.innerHTML,/<header[^>]*>.*identity-card__user-row.*data-hub-sync.*<\/header>/);
 h.handlers.click({target:{closest:()=>({disabled:false,dataset:{hubItem:'2'}})}});
 assert.equal(h.dialog.dataset.panel,'records');
 assert.equal(h.syncHost.child,syncStatusElement);
 syncStatusElement.innerHTML='<button class="sync-status-button--synced">✓</button>';
 assert.match(h.syncHost.child.innerHTML,/✓/);
});

test('institutional surveys open from their menu button and return to surveys',()=>{
 const h=hub({surveys:true},'surveys',null,true);
 assert.match(h.body.innerHTML,/PESQUISAS INSTITUCIONAIS/);
 assert.doesNotMatch(h.body.innerHTML,/href=/);
 h.handlers.click({target:{closest:()=>({disabled:false,dataset:{hubItem:'0'}})}});
 assert.equal(h.dialog.dataset.panel,'institutional');
 assert.match(h.body.innerHTML,/stress.html/);
 h.handlers['back-click']();
 assert.equal(h.dialog.dataset.panel,'surveys');
});
