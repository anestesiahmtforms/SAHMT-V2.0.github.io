import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {canUseManagementPilot,canUseGovernanceHub} from '../src/management-pilot.js';
const pilot=()=>({status:'signed-in',user:{uid:'synthetic',email:'wx2901@gmail.com',emailVerified:true},profile:{uid:'synthetic',email:'wx2901@gmail.com',active:true,access:true,role:'temporario',permissions:{}}});
test('pilot requires the verified account, matching profile, and active approved session',()=>{
 assert.equal(canUseManagementPilot(pilot()),true);
 for(const change of [s=>s.user.email='other@example.test',s=>s.user.emailVerified=false,s=>s.profile.email='other@example.test',s=>s.profile.uid='other',s=>s.profile.active=false,s=>s.profile.access=false,s=>s.status='auth-limited']){const s=pilot();change(s);assert.equal(canUseManagementPilot(s),false);}
 const admin=pilot();admin.user.email='owner@example.test';admin.profile.role='administrador_app';assert.equal(canUseManagementPilot(admin),true);admin.profile.active=false;assert.equal(canUseManagementPilot(admin),false);
});
function hub(access={},initialPanel='home',syncStatusElement=null,climateEnabled=false){
 const syncHost={append(element){this.child=element;}},handlers={},heading={focus(){}},headingIcon={innerHTML:''},body={innerHTML:'',scrollTop:0,addEventListener:(n,fn)=>handlers[n]=fn},back={addEventListener:(n,fn)=>handlers['back-'+n]=fn},dialog={dataset:{},querySelector:s=>s==='[data-hub-sync]'?syncHost:s==='[data-hub-body]'?body:s==='[data-hub-back]'?back:s==='#management-hub-title'?heading:s==='[data-hub-heading-icon]'?headingIcon:{},addEventListener(){},showModal(){}},root={querySelector:()=>dialog};
 const navigations=[],ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../src/management-hub.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''),ctx);ctx.mountManagementHub(root,{access,initialPanel,syncStatusElement,climateEnabled,onExit(){navigations.push('home');},onNavigate:route=>navigations.push(route)});return {dialog,body,handlers,navigations,heading,headingIcon,root,back,syncHost};
}
test('FA institutional survey entry embeds the fixed FE destinations without identity URL parameters',()=>{
 const released=hub({surveys:true},'institutional',null,true);assert.match(released.body.innerHTML,/data-survey-panel="climateForm"/);assert.match(released.body.innerHTML,/data-survey-panel="stressForm"/);assert.doesNotMatch(released.body.innerHTML,/href=|uid=|email=|token=/);assert.match(released.body.innerHTML,/PESQUISA DE CLIMA ORGANIZACIONAL/);assert.match(released.body.innerHTML,/AVALIAÇÃO DE ESTRESSE E FADIGA/);
 assert.doesNotMatch(hub({surveys:true},'institutional',null,false).body.innerHTML,/data-survey-panel=/);
});

test('common users see all five disabled buttons; deep links cannot open paused subpanels',()=>{
 for(const initialPanel of ['home','records','indicators','results','surveys','institutional','climateForm','stressForm']){const h=hub({},initialPanel);assert.equal(h.dialog.dataset.panel,'home');assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,5);assert.equal((h.body.innerHTML.match(/ disabled /g)||[]).length,5);}
 const h=hub({groups:true,performance:true,records:true,results:true,surveys:true,qmentum:true});assert.doesNotMatch(h.body.innerHTML,/ disabled /);
});
test('Governança header uses the existing Diamond seal while retaining all five destinations',()=>{
 const h=hub({groups:true,performance:true,records:true,results:true,surveys:true,qmentum:true});assert.equal(h.heading.textContent,'Governança');assert.ok(h.root.innerHTML.includes('</header><div class="management-hub-content-panel">'));assert.match(h.headingIcon.innerHTML,/img[^>]+selo-qga-accredited-qmentum-diamond\.png[^>]+alt="Diamond Qmentum"/);assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,5);
});
test('Registro de Indicadores opens QMENTUM directly and the old folder link returns to Registros',()=>{
 const h=hub({records:true,qmentum:true},'indicators');assert.equal(h.dialog.dataset.panel,'records');assert.match(h.body.innerHTML,/Registro de Indicadores/);assert.doesNotMatch(h.body.innerHTML,/Indicadores Qmentum/);
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'1'}}):null}});assert.deepEqual(h.navigations,['qmentum']);
 const paused=hub({records:true},'records');paused.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'1'}}):null}});assert.deepEqual(paused.navigations,[]);
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
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'2'}}):null}});
 assert.equal(h.dialog.dataset.panel,'records');
 assert.equal(h.syncHost.child,syncStatusElement);
 syncStatusElement.innerHTML='<button class="sync-status-button--synced">✓</button>';
 assert.match(h.syncHost.child.innerHTML,/✓/);
});

test('institutional surveys open from their menu button and return to surveys',()=>{
 const h=hub({surveys:true},'surveys',null,true);
 assert.match(h.body.innerHTML,/PESQUISAS INSTITUCIONAIS/);
 assert.doesNotMatch(h.body.innerHTML,/href=/);
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'0'}}):null}});
 assert.equal(h.dialog.dataset.panel,'institutional');
 assert.match(h.body.innerHTML,/data-survey-panel="stressForm"/);
 h.handlers['back-click']();
 assert.equal(h.dialog.dataset.panel,'surveys');
});

test('approved verified team members enter Governance for the schedule without gaining management access',()=>{
 for(const role of ['gestor','coordenador','anestesiologista','temporario']){const common=pilot();common.profile.role=role;common.user.email='common@example.invalid';common.profile.email=common.user.email;assert.equal(canUseGovernanceHub(common),true);assert.equal(canUseManagementPilot(common),false);}
 assert.equal(canUseGovernanceHub(pilot()),true);
 for(const change of [s=>s.user.emailVerified=false,s=>s.profile.email='other@example.invalid',s=>s.profile.uid='other',s=>s.profile.access=false]){const current=pilot();change(current);assert.equal(canUseGovernanceHub(current),false);}
 for(const permissions of [{admin:true},{}]){const admin=pilot();admin.user.email='owner@example.invalid';admin.profile.role=permissions.admin?'anestesiologista':'administrador_app';admin.profile.permissions=permissions;assert.equal(canUseGovernanceHub(admin),true);admin.profile.active=false;assert.equal(canUseGovernanceHub(admin),false);}
});

test('schedule access opens its menu while other survey panels retain their previous gate',()=>{
 const h=hub({yearEndSchedule:true},'home');
 assert.equal((h.body.innerHTML.match(/ disabled /g)||[]).length,4);
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'4'}}):null}});
 assert.equal(h.dialog.dataset.panel,'surveys');assert.match(h.body.innerHTML,/ESCALA FINAL DE ANO/);assert.match(h.body.innerHTML,/management-hub-button--festive/);
 assert.equal((h.body.innerHTML.match(/ disabled /g)||[]).length,3);
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'0'}}):null}});
 assert.equal(h.dialog.dataset.panel,'surveys');
});
