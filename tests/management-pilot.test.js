import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {canUseManagementPilot,canUseGovernanceHub} from '../src/management-pilot.js';
const pilot=()=>({status:'signed-in',user:{uid:'synthetic',email:'wx2901@gmail.com',emailVerified:true},profile:{uid:'synthetic',email:'wx2901@gmail.com',active:true,access:true,role:'temporario',permissions:{}}});
test('pilot requires the verified account, matching profile, and active approved session',()=>{
 assert.equal(canUseManagementPilot(pilot()),true);
 for(const change of [s=>s.user.email='other@example.test',s=>s.user.emailVerified=false,s=>s.profile.email='other@example.test',s=>s.profile.uid='other',s=>s.profile.active=false,s=>s.profile.access=false,s=>s.status='auth-limited']){const s=pilot();change(s);assert.equal(canUseManagementPilot(s),false);}
 const admin=pilot();admin.user.email='owner@example.test';admin.profile.role='administrador_app';assert.equal(canUseManagementPilot(admin),true);admin.profile.active=false;assert.equal(canUseManagementPilot(admin),false);
});
function hub(access={},initialPanel='home',syncStatusElement=null,climateEnabled=false,folderAllowed=()=>true){
 const syncHost={append(element){this.child=element;}},handlers={},heading={focus(){}},headingIcon={innerHTML:''},body={innerHTML:'',scrollTop:0,addEventListener:(n,fn)=>handlers[n]=fn},back={addEventListener:(n,fn)=>handlers['back-'+n]=fn},dialog={dataset:{},querySelector:s=>s==='[data-comm-origin]'?null:s==='[data-hub-sync]'?syncHost:s==='[data-hub-body]'?body:s==='[data-hub-back]'?back:s==='#management-hub-title'?heading:s==='[data-hub-heading-icon]'?headingIcon:{},addEventListener(){},showModal(){}},root={querySelector:()=>dialog};
 const navigations=[],ctx=vm.createContext({consolidatedPerformanceFolders:['desempenho/sahmt'],operationalContentAllowed:()=>true});vm.runInContext(readFileSync(new URL('../src/management-hub.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''),ctx);ctx.mountManagementHub(root,{access,initialPanel,syncStatusElement,climateEnabled,folderAllowed,onExit(){navigations.push('home');},onNavigate:route=>navigations.push(route)});return {dialog,body,handlers,navigations,heading,headingIcon,root,back,syncHost};
}
test('Climate and stress appear only in the restricted area for effective team members',()=>{
 const released=hub({institutionalSurveys:true,teamSurveys:true},'institutional',null,true);
 assert.doesNotMatch(released.body.innerHTML,/href=|uid=|email=|token=/);
 assert.match(released.body.innerHTML,/PESQUISA DE CLIMA ORGANIZACIONAL/);
 assert.match(released.body.innerHTML,/AVALIAÇÃO DE ESTRESSE E FADIGA/);
 for(const panel of ['general','institutional']) {
  const otherProfile=hub({institutionalSurveys:true,surveys:true},panel,null,true);
  assert.doesNotMatch(otherProfile.body.innerHTML,/PESQUISA DE CLIMA|AVALIAÇÃO DE ESTRESSE/);
 }
 assert.doesNotMatch(hub({surveys:true,teamSurveys:true},'institutional',null,false).body.innerHTML,/PESQUISA DE CLIMA|AVALIAÇÃO DE ESTRESSE/);
 assert.doesNotMatch(hub({institutionalSurveys:true},'general',null,false).body.innerHTML,/data-survey-panel=/);
});
test('inactive folders stay visible while profile gates hide restricted content',()=>{
 const publicAccess={institutionalSurveys:true,fePerformance:true};
 const folderAllowed=id=>!id.startsWith('consultas');
 const view=hub(publicAccess,'surveys',null,true,folderAllowed);
 assert.match(view.body.innerHTML,/ACESSO GERAL/);
 assert.doesNotMatch(view.body.innerHTML,/ACESSO RESTRITO/);
 view.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?{dataset:{hubItem:'1'}}:null}});
 assert.equal(view.dialog.dataset.panel,'general');
 assert.match(view.body.innerHTML,/data-survey-panel="fePerformance"/);
 assert.doesNotMatch(view.body.innerHTML,/data-survey-panel="fePerformance" disabled/);
 view.handlers.click({target:{closest:selector=>selector==='[data-survey-panel]'?{dataset:{surveyPanel:'fePerformance'}}:null}});
 assert.equal(view.dialog.dataset.panel,'fePerformance');
 assert.match(view.body.innerHTML,/Pasta inativa/);
 assert.doesNotMatch(view.body.innerHTML,/data-fe-performance|iframe/);
 const effective=hub({...publicAccess,teamSurveys:true},'institutional',null,true,folderAllowed);
 assert.match(effective.body.innerHTML,/data-hub-item="0"/);
 assert.doesNotMatch(effective.body.innerHTML,/data-hub-item="0" disabled/);
 assert.match(effective.body.innerHTML,/PESQUISA DE CLIMA ORGANIZACIONAL/);
 assert.match(effective.body.innerHTML,/AVALIAÇÃO DE ESTRESSE E FADIGA/);
 const direct=hub({...publicAccess,teamSurveys:true},'climateForm',null,true,folderAllowed);
 assert.equal(direct.dialog.dataset.panel,'climateForm');
 assert.match(direct.body.innerHTML,/Pasta inativa/);
 assert.doesNotMatch(direct.body.innerHTML,/iframe/);
 assert.equal(hub(publicAccess,'climateForm',null,true,folderAllowed).dialog.dataset.panel,'home');
});
test('restricted FE opens vaccination directly, excludes dosimetry and respects folder blocking',()=>{
 const access={institutionalSurveys:true,biosafety:true};
 const allowed=hub(access,'institutional');
 assert.match(allowed.body.innerHTML,/MEU HISTÓRICO VACINAL/);
 assert.doesNotMatch(allowed.body.innerHTML,/BIOSSEGURANÇA|DOSIMETRIA|MANUAL/);
 assert.doesNotMatch(hub({institutionalSurveys:true},'institutional').body.innerHTML,/MEU HISTÓRICO VACINAL/);
 assert.equal(hub({institutionalSurveys:true},'dosimetryHistory').dialog.dataset.panel,'home');
 const oldLink=hub(access,'biosafety');assert.equal(oldLink.dialog.dataset.panel,'institutional');
 const paused=hub(access,'institutional',null,true,id=>!id.startsWith('consultas'));
 assert.match(paused.body.innerHTML,/data-hub-item="6"[^]*MEU HISTÓRICO VACINAL/);
 assert.doesNotMatch(paused.body.innerHTML,/data-hub-item="6" disabled/);
 paused.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?{dataset:{hubItem:'6'}}:null}});
 assert.equal(paused.dialog.dataset.panel,'vaccinationHistory');
 assert.match(paused.body.innerHTML,/Pasta inativa/);
 allowed.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?{dataset:{hubItem:'6'}}:null}});
 assert.equal(allowed.dialog.dataset.panel,'vaccinationHistory');
 allowed.handlers['back-click']();assert.equal(allowed.dialog.dataset.panel,'institutional');
});

test('FE performance is available only inside FE institutional surveys',()=>{
 const source=readFileSync(new URL('../src/management-hub.js',import.meta.url),'utf8');
 const metadata=source.slice(source.indexOf('const panels='),source.indexOf('// Surveys reuse'));
 const panels=vm.runInNewContext(metadata+';panels');
 assert.equal(panels.fdPerformance,undefined);
 assert.equal(panels.fePerformance.parent,'general');
 assert.equal(panels.sahmtPerformance,undefined);
 assert.equal(panels.home.items.some(item=>['fdPerformance','fePerformance'].includes(item.panel)),false);
 assert.equal(panels.surveys.items.some(item=>item.label==='Desempenho FE'&&item.panel==='fePerformance'),false);
 assert.equal(panels.records.items.some(item=>['fdPerformance','fePerformance'].includes(item.panel)),false);
 assert.doesNotMatch(hub({surveys:true},'surveys').body.innerHTML,/Desempenho FE/);
 assert.doesNotMatch(hub({surveys:true,fePerformance:true},'surveys').body.innerHTML,/Desempenho FE/);
 assert.match(hub({institutionalSurveys:true,fePerformance:true},'general',null,true).body.innerHTML,/DESEMPENHO FE/);
 for(const name of ['fdPerformance','fePerformance'])assert.equal(hub({},name).dialog.dataset.panel,'home');
});

test('common users do not see performance and deep links cannot open paused subpanels',()=>{
 for(const initialPanel of ['home','records','indicators','results','surveys','institutional','climateForm','stressForm','vacations2027']){const h=hub({},initialPanel);assert.equal(h.dialog.dataset.panel,'home');assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,4);assert.equal((h.body.innerHTML.match(/ disabled /g)||[]).length,4);}
 const h=hub({groups:true,performance:true,records:true,results:true,surveys:true,qmentum:true});assert.doesNotMatch(h.body.innerHTML,/ disabled /);
});
test('Governança header uses the existing Diamond seal while concentrating performance inside Indicators',()=>{
 const h=hub({groups:true,performance:true,records:true,results:true,surveys:true,qmentum:true});assert.equal(h.heading.textContent,'Governança');assert.ok(h.root.innerHTML.includes('</header><div class="management-hub-content-panel">'));assert.match(h.headingIcon.innerHTML,/img[^>]+selo-qga-accredited-qmentum-diamond\.png[^>]+alt="Diamond Qmentum"/);assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,4);
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

test('the general area remains available and returns to Enquetes e Consultas',()=>{
 const h=hub({institutionalSurveys:true},'surveys',null,true);
 assert.match(h.body.innerHTML,/ACESSO GERAL/);
 assert.doesNotMatch(h.body.innerHTML,/href=/);
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'1'}}):null}});
 assert.equal(h.dialog.dataset.panel,'general');
 assert.doesNotMatch(h.body.innerHTML,/PESQUISA DE CLIMA|AVALIAÇÃO DE ESTRESSE/);
 h.handlers['back-click']();
 assert.equal(h.dialog.dataset.panel,'surveys');
});

test('Governance opens for every approved identity without granting protected destinations',()=>{
 for(const role of ['gestor','coordenador','anestesiologista','temporario']){const common=pilot();common.profile.role=role;common.user.email='common@example.invalid';common.profile.email=common.user.email;assert.equal(canUseGovernanceHub(common),true);assert.equal(canUseManagementPilot(common),false);}
 assert.equal(canUseGovernanceHub(pilot()),true);
 for(const change of [s=>s.user.emailVerified=false,s=>s.profile.email='other@example.invalid',s=>s.profile.uid='other',s=>s.profile.access=false]){const current=pilot();change(current);assert.equal(canUseGovernanceHub(current),false);}
 for(const permissions of [{admin:true},{}]){const admin=pilot();admin.user.email='owner@example.invalid';admin.profile.email=admin.user.email;admin.profile.role=permissions.admin?'anestesiologista':'administrador_app';admin.profile.permissions=permissions;assert.equal(canUseGovernanceHub(admin),true);admin.profile.active=false;assert.equal(canUseGovernanceHub(admin),false);}
});

test('schedule access opens its menu while other survey panels retain their previous gate',()=>{
 const h=hub({yearEndSchedule:true},'home');
 assert.equal((h.body.innerHTML.match(/ disabled /g)||[]).length,3);
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'4'}}):null}});
 assert.equal(h.dialog.dataset.panel,'surveys');assert.match(h.body.innerHTML,/ACESSO RESTRITO/);
 assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,1);
 h.handlers.click({target:{closest:selector=>selector==='[data-hub-item]'?({disabled:false,dataset:{hubItem:'0'}}):null}});
 assert.equal(h.dialog.dataset.panel,'institutional');assert.match(h.body.innerHTML,/ESCALA FINAL DE ANO/);assert.match(h.body.innerHTML,/management-hub-button--festive/);
});

test('performance buttons are absent when their administrator access is denied',()=>{
 assert.doesNotMatch(hub({groups:true,records:true,surveys:true}).body.innerHTML,/management-hub-label">Desempenho/);
 assert.doesNotMatch(hub({records:true},'records').body.innerHTML,/Desempenho FC/);
 assert.doesNotMatch(hub({records:true,fcPerformance:true},'records').body.innerHTML,/Desempenho FC/);
 assert.doesNotMatch(hub({performance:true}).body.innerHTML,/management-hub-label">Desempenho/);
});

test('vacation-only access opens FE without allowing survey forms or performance',()=>{
 const h=hub({vacations2027:true},'surveys');assert.equal(h.dialog.dataset.panel,'surveys');assert.match(h.body.innerHTML,/ACESSO RESTRITO/);assert.match(hub({vacations2027:true},'institutional').body.innerHTML,/ESCALA DE FÉRIAS 2027/);assert.equal((h.body.innerHTML.match(/data-hub-item=/g)||[]).length,1);assert.doesNotMatch(h.body.innerHTML,/Desempenho FE/);
 for(const panel of ['professional','epidemiological','climateForm','general','results','records'])assert.equal(hub({vacations2027:true},panel).dialog.dataset.panel,'home');
});

test('FE shows only surveys to common profiles and the other four entries to team profiles',()=>{
 const publicAccess={institutionalSurveys:true};
 const common=hub(publicAccess,'surveys');
 assert.equal((common.body.innerHTML.match(/data-hub-item=/g)||[]).length,1);
 assert.match(common.body.innerHTML,/ACESSO GERAL/);
 for(const panel of ['professional','epidemiological','yearEnd','vacations2027'])assert.equal(hub(publicAccess,panel).dialog.dataset.panel,'home');
 const team=hub({...publicAccess,surveys:true,epidemiological:true,yearEndSchedule:true,vacations2027:true},'surveys');
 assert.equal((team.body.innerHTML.match(/data-hub-item=/g)||[]).length,2);
 const restricted=hub({...publicAccess,surveys:true,epidemiological:true,yearEndSchedule:true,vacations2027:true},'institutional');
 assert.equal((restricted.body.innerHTML.match(/data-hub-item=/g)||[]).length,4);
 assert.doesNotMatch(restricted.body.innerHTML,/PESQUISA DE CLIMA/);
});
