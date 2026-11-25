import test from 'node:test';import assert from 'node:assert/strict';
import {PROFESSIONAL_FIELDS,EPIDEMIOLOGICAL_FIELDS,validateProfessionalAnswers,validateEpidemiologicalSubmission,bmiBand,scheduleParticipationPercent} from '../src/registration-domain.js';
import {createProfessionalRegistrationService} from '../worker-training/professional-registration-service.js';
import {createFcRegistrationHandler} from '../worker-fc-integration/registration.js';
import {createSurveyService} from '../worker-training/survey-service.js';
import {aggregateEpidemiological} from '../src/epidemiological-aggregate.js';
import {renderFunctionalResult} from '../src/functional-results.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';import {institutionalAssignmentKey} from '../src/institutional-group.js';
export const identity={uid:'synthetic-registration',email:'synthetic@example.invalid',emailVerified:true,provider:'google.com'};
export function professionalAnswers(){return {...Object.fromEntries(PROFESSIONAL_FIELDS.map(f=>[f.id,['checks','multi-select'].includes(f.type)?f.options.slice(0,f.min||1).map(([v])=>v):f.options?f.options[0][0]:f.required?'Informação sintética':''])),fullName:'Pessoa Sintética',birthDate:'1990-01-01',cpf:'52998224725',crm:'12345',workDays:['0:WEEKLY'],phone:'31999999999',lattes:'https://lattes.cnpq.br/1234567890123456'};}

test('100% de participação exige sete dias integrais e sete plantões noturnos semanais',()=>{
 const fullWeek = Array.from({length:7},(_,day)=>[day+':FULL',day+':ON_CALL']).flat();
 const mondayToSaturday = Array.from({length:6},(_,day)=>day+':FULL');
 const percent = shifts => 100 * shifts / 14;
 assert.equal(scheduleParticipationPercent(fullWeek),100);
 assert.equal(scheduleParticipationPercent(mondayToSaturday),percent(6));
 assert.equal(scheduleParticipationPercent([...mondayToSaturday,'6:FULL']),50);
 assert.equal(scheduleParticipationPercent(['0:WEEKLY','0:MORNING']),percent(0.5));
 assert.equal(scheduleParticipationPercent(['0:WEEKLY','0:AFTERNOON']),percent(0.5));
 assert.equal(scheduleParticipationPercent(['5:FULL','5:FORTNIGHTLY']),percent(0.5));
 assert.equal(scheduleParticipationPercent(['5:MORNING','5:FORTNIGHTLY']),percent(0.25));
 assert.equal(scheduleParticipationPercent(['0:MORNING','0:AFTERNOON']),percent(1));
 assert.equal(scheduleParticipationPercent(['0:FULL','0:MORNING','0:AFTERNOON','0:ON_CALL']),percent(2));
 assert.equal(scheduleParticipationPercent(['1:WEEKLY','1:ON_CALL']),percent(1));
 assert.equal(scheduleParticipationPercent(['1:FORTNIGHTLY','1:ON_CALL']),percent(0.5));
 assert.equal(scheduleParticipationPercent(['6:FULL']),percent(1));
 assert.equal(scheduleParticipationPercent(['6:ON_CALL']),percent(1));
 assert.equal(scheduleParticipationPercent(['6:FORTNIGHTLY','6:FULL','6:ON_CALL']),percent(1));
 assert.equal(scheduleParticipationPercent([...fullWeek,'6:FORTNIGHTLY']),percent(13));
 assert.equal(scheduleParticipationPercent([...mondayToSaturday,'6:WEEKLY','6:MORNING','6:AFTERNOON']),percent(6));
 assert.equal(scheduleParticipationPercent(['6:WEEKLY','6:MORNING']),null);
 assert.equal(scheduleParticipationPercent(['6:FORTNIGHTLY']),null);
 assert.equal(scheduleParticipationPercent(['0:FULL','0:WEEKLY','0:FORTNIGHTLY']),percent(0.5));
 const mondayToThursday = Array.from({length:4},(_,day)=>[day+':WEEKLY',day+':FULL']).flat();
 assert.equal(scheduleParticipationPercent([...mondayToThursday,'5:WEEKLY','5:FORTNIGHTLY']),percent(4));
 assert.equal(scheduleParticipationPercent(['0:WEEKLY']),null);
 assert.equal(scheduleParticipationPercent(['0','5']),null);
 assert.equal(scheduleParticipationPercent([]),null);
});

test('professional registration can be called by administrators and verifies only the saved status',async()=>{
 const store=await fixture();
 const admin={...identity,uid:'admin-catalog',email:'admin@example.invalid'};
 store.seed('users',admin.uid,{uid:admin.uid,email:admin.email,role:'administrador_app',active:true,access:true});
 const service=createProfessionalRegistrationService({store,now:()=>42});
 const item={kind:'SURVEY',id:'professional',title:'Cadastro Profissional - SAHMT',cycle:'2026'};
 const activity={survey:item.id,cycle:item.cycle};
 const input={...activity,recipients:[{uid:'ff-member',email:identity.email},{uid:'ff-unknown',email:'unknown@example.invalid'}]};
 assert.deepEqual(await service.execute('OBLIGATION_CATALOG',{},admin),{items:[item]});
 await assert.rejects(service.execute('OBLIGATION_CATALOG',{},identity),{code:'REGISTRATION_FORBIDDEN'});
 assert.deepEqual(await service.execute('OBLIGATION_ELIGIBILITY',input,admin),{eligibleUids:['ff-member'],excluded:[{uid:'ff-unknown',reason:'REGISTRATION_FORBIDDEN'}]});
 assert.deepEqual(await service.execute('OBLIGATION_STATUS',activity,identity),{completed:false});
 await service.execute('SAVE',{expectedVersion:0,truth:true,answers:professionalAnswers()},identity);
 store.seed('runtimePolicy','folders',{schemaVersion:1,revision:1,disabled:['consultas/cadastro-profissional']});
 assert.deepEqual(await service.execute('OBLIGATION_CATALOG',{},admin),{items:[]});
 assert.deepEqual(await service.execute('OBLIGATION_STATUS',activity,identity),{completed:true});
 await assert.rejects(service.execute('OBLIGATION_STATUS',{...activity,uid:identity.uid},admin),{code:'REGISTRATION_INVALID_INPUT'});
});
export async function fixture(category='EFETIVO'){const store=vaccinationMemoryStore();store.seed('users',identity.uid,{uid:identity.uid,email:identity.email,active:true,access:true});store.seed('userCategories',await institutionalAssignmentKey(identity.email),{schemaVersion:1,identityStatus:'LINKED',uid:identity.uid,email:identity.email,memberCategories:[category]});return store;}
test('the professional form accepts a weekly grid and several surgical areas without retired fields',()=>{
 const answers=professionalAnswers();
 answers.workDays=['0:WEEKLY','0:MORNING','6:ON_CALL'];
 answers.surgicalAreas=['CARDIOVASCULAR','UROLOGY'];
 assert.deepEqual(validateProfessionalAnswers(answers).workDays,answers.workDays);
 assert.deepEqual(validateProfessionalAnswers(answers).surgicalAreas,answers.surgicalAreas);
 for(const workDays of [['7:WEEKLY'],['0:INVALID'],['0:WEEKLY','0:WEEKLY']])assert.throws(()=>validateProfessionalAnswers({...answers,workDays}));
 assert.throws(()=>validateProfessionalAnswers({...answers,surgicalAreas:['NONE','UROLOGY']}));
});
test('the professional form saves multiple qualifications and institutional roles',()=>{
 const fields=PROFESSIONAL_FIELDS.map(({id})=>id);
 assert.deepEqual(fields.slice(fields.indexOf('formation'),fields.indexOf('lattes')),
  ['formation','teachingResearch','institutionalParticipation']);
 assert.equal(fields.includes('technicalSkills')||fields.includes('leadership'),false);
 const input={...professionalAnswers(),formation:['TEA','RQE','DOCENTE'],institutionalParticipation:['GESTAO','DIRECAO']};
 assert.deepEqual(validateProfessionalAnswers(input).formation,['TEA','RQE','DOCENTE']);
 assert.deepEqual(validateProfessionalAnswers(input).institutionalParticipation,['GESTAO','DIRECAO']);
 assert.deepEqual(validateProfessionalAnswers({...input,formation:[],institutionalParticipation:[]}).formation,[]);
 assert.throws(()=>validateProfessionalAnswers({...input,formation:['OUTRA']}),{code:'REGISTRATION_INVALID_FORMATION'});
 assert.throws(()=>validateProfessionalAnswers({...input,institutionalParticipation:['GESTAO','GESTAO']}),{code:'REGISTRATION_INVALID_INSTITUTIONALPARTICIPATION'});
});
test('a saved registration retains its original answers when updated to the new form',async()=>{
 const store=await fixture(),service=createProfessionalRegistrationService({store});
 const before={formation:'Formação livre',technicalSkills:'Técnica',leadership:'Liderança',institutionalParticipation:'Comissão'};
 const legacy={workDays:['0','7'],surgicalAreas:'Urologia',crmState:'MG',shifts:'Plantão',surgicalDetails:'',complementarySkills:'Nenhuma',...before};
 const {motherName,fatherName,...combinedFields}=professionalAnswers();
 const filiation='Nomes registrados antes da separação';
 const v1={...combinedFields,filiation,...legacy};
 const old=await service.execute('SAVE',{answers:v1,expectedVersion:0,truth:true},identity);
 assert.equal(old.record.schemaVersion,1);
 const v2={...combinedFields,filiation,...before};
 const second=await service.execute('SAVE',{answers:v2,expectedVersion:1,truth:true},identity);
 assert.equal(second.record.schemaVersion,2);
 const v3={...combinedFields,filiation};
 const previous=await service.execute('SAVE',{answers:v3,expectedVersion:2,truth:true},identity);
 assert.equal(previous.record.schemaVersion,3);
 const answers={...professionalAnswers(),motherName:'Mãe sintética',fatherName:'Pai sintético'};
 store.seed('runtimePolicy','folders',{schemaVersion:1,revision:1,disabled:[]});
 const request=createFcRegistrationHandler({verify:async()=>identity,build:()=>({store,professional:service})});
 const path='/v1/professional-registration';
 const response=await request(new Request('https://synthetic.invalid'+path,{method:'POST',
  headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},
  body:JSON.stringify({action:'SAVE',input:{answers,expectedVersion:3,truth:true}})}),
  {FC_PROFESSIONAL_REGISTRATION_ENABLED:'true'},path);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.record.schemaVersion,4);
 assert.equal(result.record.answers.motherName,'Mãe sintética');
 assert.equal(result.record.answers.fatherName,'Pai sintético');
 assert.deepEqual(result.record.legacyAnswers,{...legacy,filiation});
 await assert.rejects(service.execute('SAVE',{answers:v3,expectedVersion:4,truth:true},identity),{code:'REGISTRATION_SCHEMA_CHANGED'});
});

test('Funcional renders the full registration with translated choices, older answers and receipt metadata',()=>{
 const answers={...professionalAnswers(),motherName:'Pessoa Mãe',fatherName:'Pessoa Pai',birthDate:'1990-01-02',
  outsideWork:'YES',outsideWorkDetails:'Primeira linha\nSegunda linha',formation:['TEA','DOCENTE'],
  workDays:['0:WEEKLY','0:MORNING','6:ON_CALL'],surgicalAreas:['THORACIC'],additionalInfo:'<script>Teste</script>'};
 const record={cycle:'2026',email:identity.email,truth:true,answers,legacyAnswers:{filiation:'Filiação original',workDays:['7'],crmState:'MG'}};
 const files=[{subject:'QUALIFICATIONS',name:'diploma.pdf',status:'STORED',uploadedAt:Date.parse('2026-11-19T16:00:00Z')}];
 const result=renderFunctionalResult('professionalRegistration',{record,files});
 for(const {label} of PROFESSIONAL_FIELDS)assert.ok(result.includes(label),label);
 assert.match(result,/Pessoa Mãe[\s\S]*Pessoa Pai/);
 assert.match(result,/02\/01\/1990[\s\S]*Idade atual[\s\S]*anos, \d+ (?:mês|meses) e \d+ (?:dia|dias)/);
 for(const label of ['Segunda-feira · Semanal, Manhã','Domingo · Plantão','Torácica','TEA, Docente','Sim',
  'Filiação original','Escala variável','UF do CRM','Diplomas e certificados','diploma.pdf','19/11/2026']){
  assert.ok(result.includes(label),label);
 }
 assert.match(result,/&lt;script&gt;Teste&lt;\/script&gt;/);
 assert.doesNotMatch(result,/<script>/);
 const partial=renderFunctionalResult('professionalRegistration',{record,files:null});
 assert.ok(partial.includes('Pessoa Mãe')&&partial.includes('Não foi possível consultar os comprovantes'));
});
test('Funcional vaccination shows the identified record and only confirmed receipt metadata',()=>{
 const record={displayName:'Pessoa Sintética',email:identity.email,year:2026,category:'Equipe',truth:true,awareness:true,
  states:{hepatitisB:'UPDATED',tetanus:'PENDING'},declaration:'WILL_UPDATE',notes:'<img src=invalid>',updatedAt:'2026-11-19T16:00:00Z'};
 const files=[{subject:'hepatitisB',name:'registro.pdf',uploadedAt:'2026-11-19T16:00:00Z'}];
 const result=renderFunctionalResult('vaccination',{record,files});
 for(const label of ['Pessoa Sintética',identity.email,'Equipe','Hepatite B','Atualizada','Pendente','Pretendo atualizar minha vacinação',
  'Declaração de veracidade','Ciência das orientações','19/11/2026','registro.pdf','&lt;img src=invalid&gt;'])assert.ok(result.includes(label),label);
 assert.doesNotMatch(result,/<img/);
});
const completeEpiAnswers=()=>Object.fromEntries(EPIDEMIOLOGICAL_FIELDS.map(f=>[f.id,f.type==='checks'?[f.options[0][0]]:f.options[0][0]]));
const epi=(patch={})=>({survey_cycle:'2026',survey_version:'1.0',submission_id:'a'.repeat(32),consent:true,group:'team',answers:{sleep:'0'},...patch});
test('professional schema validates CPF/date/phone and rejects injected routing or identity',()=>{const v=validateProfessionalAnswers(professionalAnswers());assert.equal(v.cpf,'52998224725');for(const patch of [{uid:'other'},{folderId:'injection'},{cpf:'11111111111'},{birthDate:'2026-02-30'},{phone:'..........'},{lattes:'https://evil.invalid'},{managementAreas:[]}])assert.throws(()=>validateProfessionalAnswers({...professionalAnswers(),...patch}));});
test('identified professional records are own-only, versioned and revocation-aware',async()=>{const store=await fixture(),service=createProfessionalRegistrationService({store,now:()=>42});const boot=await service.execute('BOOTSTRAP',{},identity);assert.equal(boot.profile.group,'team');assert.equal(boot.record,null);const input={expectedVersion:0,truth:true,answers:professionalAnswers()};const results=await Promise.allSettled([service.execute('SAVE',input,identity),service.execute('SAVE',input,identity)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'REGISTRATION_VERSION_CONFLICT');assert.equal((await store.list('professionalRegistrations')).length,1);for(const action of ['LIST','DETAIL'])await assert.rejects(service.execute(action,action==='DETAIL'?{uid:'other'}:{},identity),e=>e.code==='REGISTRATION_FORBIDDEN');await assert.rejects(service.execute('BOOTSTRAP',{uid:'other'},identity));store.beforeCommit=()=>store.seed('users',identity.uid,{uid:identity.uid,email:identity.email,active:false,access:true});await assert.rejects(service.execute('SAVE',{...input,expectedVersion:1},identity));assert.equal((await store.get('professionalRegistrations',identity.uid+'_2026')).version,1);});
test('epidemiological data excludes identity and exact measurements, uses optional closed categories',()=>{const v=validateEpidemiologicalSubmission(epi());assert.equal(v.consent,true);assert.equal(v.answers.ageBand,'NI');assert.equal(bmiBand(70,175).band,'MID');for(const patch of [{email:'x'},{weight:70},{group:'substitute'},{answers:{weight:70}},{answers:{conditions:['NONE','CARDIO']}},{answers:{familyHistory:['UNKNOWN','DIAB']}},{answers:{}},{consent:false}])assert.throws(()=>validateEpidemiologicalSubmission(epi(patch)));});
test('epidemiological participation ledger remains separate and retries cannot add answers',async()=>{const profileStore=await fixture(),responseStore=vaccinationMemoryStore();responseStore.seed('epidemiologicalCycles','2026',{status:'open'});const service=createSurveyService({profileStore,responseStore,uuid:()=> 'b'.repeat(32)}),input={survey:'epidemiological',cycle:'2026',response:epi({group:'resident',answers:completeEpiAnswers(),comments:'Sugestão sintética'})};assert.equal((await service.execute('BOOTSTRAP',{survey:'epidemiological',cycle:'2026'},identity)).group,'team');await service.execute('SUBMIT',input,identity);assert.equal((await service.execute('SUBMIT',{...input,response:{...input.response,submission_id:'c'.repeat(32)}},identity)).alreadyResponded,true);const [row]=await responseStore.list('epidemiologicalResponses');assert.deepEqual(Object.keys(row).sort(),['answers','group','id','survey_cycle','survey_version']);assert.equal(row.group,'team');const [comment]=await responseStore.list('epidemiologicalComments');assert.deepEqual(Object.keys(comment).sort(),['comments','id','survey_cycle']);assert.deepEqual(await responseStore.get('surveyParticipation',identity.uid+'_epidemiological_2026'),{uid:identity.uid,survey:'epidemiological',cycle:'2026',completed:true});});
test('a complete epidemiological submission earns one point in FE and a partial submission earns none',async()=>{
 const profileStore=await fixture(),responseStore=vaccinationMemoryStore(),now=()=>Date.parse('2026-11-14T12:00:00Z');
 responseStore.seed('epidemiologicalCycles','2026',{status:'open'});
 responseStore.seed('fePerformanceRuntime','current',{schemaVersion:1,projectId:'outros-48120',enabled:true,effectiveFrom:'2026-10-01T00:00:00Z'});
 const service=createSurveyService({profileStore,responseStore,performanceEnabled:true,now});
 const input={survey:'epidemiological',cycle:'2026',response:epi()};
 await assert.rejects(service.execute('SUBMIT',input,identity),{code:'SURVEY_INVALID_INPUT'});
 const complete={...input,response:epi({answers:completeEpiAnswers(),comments:'  '})};
 for(const answers of [{...complete.response.answers,conditions:[]},{...complete.response.answers,bmiBand:'NI'}]){
  const response={...complete.response,answers};
  await assert.rejects(service.execute('SUBMIT',{...input,response},identity),{code:'SURVEY_INVALID_INPUT'});
 }
 assert.equal((await responseStore.list('surveyParticipation')).length,0);
 assert.deepEqual(await service.execute('SUBMIT',complete,identity),{accepted:true,alreadyResponded:false});
 assert.deepEqual(await service.execute('SUBMIT',complete,identity),{accepted:true,alreadyResponded:true});
 assert.equal((await responseStore.get('fePerformanceSummaries',identity.uid)).total,1);
 assert.equal((await responseStore.list('fePerformanceAwards')).length,1);
 assert.equal((await responseStore.list('epidemiologicalComments')).length,0);
});
test('epidemiological reports suppress small groups, rare cells and small missing complements',()=>{const row=()=>({survey_cycle:'2026',survey_version:'1.0',group:'team',answers:{sleep:'0',exercise:'0'}});const data=Array.from({length:10},row);const metric=r=>r.groups.team.questions.find(q=>q.id==='sleep');let r=aggregateEpidemiological(data);assert.equal(r.groups.resident.suppressed,true);assert.equal(metric(r).options[0].count,10);data[0].answers.sleep='1';assert.equal(metric(aggregateEpidemiological(data)).suppressed,true);data[0].answers.sleep='NI';assert.equal(metric(aggregateEpidemiological(data)).suppressed,true);assert.equal(aggregateEpidemiological(data.slice(0,4)).groups.team.suppressed,true);assert.equal(aggregateEpidemiological([row(),{...row(),answers:{sleep:'unknown'}}]).groups.team.suppressed,true);assert.equal(Object.hasOwn(r,'overall'),false);assert.doesNotMatch(JSON.stringify(r),/synthetic@example|52998224725/);});
test('epidemiological report is only published after closure and only to configured active admin',async()=>{const profileStore=await fixture(),responseStore=vaccinationMemoryStore(),service=createSurveyService({profileStore,responseStore,reportReaderEmail:identity.email});profileStore.seed('users',identity.uid,{...identity,active:true,access:true,role:'administrador_app'});responseStore.seed('epidemiologicalCycles','2026',{status:'open'});responseStore.seed('epidemiologicalReports','2026',{grouping_version:2,groups:{}});const input={survey:'epidemiological',cycle:'2026'};assert.equal((await service.execute('REPORT',input,identity)).report,null);responseStore.seed('epidemiologicalCycles','2026',{status:'closed'});assert.equal((await service.execute('BOOTSTRAP',input,identity)).closed,true);assert.ok((await service.execute('REPORT',input,identity)).report);await assert.rejects(service.execute('DETAIL',{...input,uid:identity.uid},identity));profileStore.seed('users',identity.uid,{...identity,active:true,access:true});await assert.rejects(service.execute('REPORT',input,identity));});

test('residents and substitutes cannot call the FE registration endpoints directly',async()=>{
 for(const category of ['RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO']){
  const store=await fixture(category);
  const registrations=createProfessionalRegistrationService({store});
  await assert.rejects(registrations.execute('BOOTSTRAP',{},identity),{code:'REGISTRATION_FORBIDDEN'});
  const surveys=createSurveyService({profileStore:store,responseStore:store});
  const request={survey:'epidemiological',cycle:'2026'};
  await assert.rejects(surveys.execute('BOOTSTRAP',request,identity),{code:'SURVEY_FORBIDDEN'});
  store.seed('users',identity.uid,{...identity,active:true,access:true,role:'administrador_app'});
  await assert.rejects(surveys.execute('BOOTSTRAP',request,identity),{code:'SURVEY_FORBIDDEN'});
  await assert.rejects(surveys.execute('SUBMIT',{...request,response:epi()},identity),{code:'SURVEY_FORBIDDEN'});
 }
});
