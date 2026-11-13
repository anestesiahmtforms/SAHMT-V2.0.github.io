import {before, after, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, setDoc, getDoc, getDocs, collection, deleteDoc} from 'firebase/firestore';
import {addFiCutoverRules} from '../scripts/lib/fi-cutover-rules.js';

const projects = {FA:'sahmt-17a16', FG:'sahmt-checklist-fg', FH:'sahmt-etiquetas-fh', FI:'sahmt-operacional-fi', FJ:'sahmt-escala-fj'};
const environments = {};
const permissions = Object.fromEntries(['checklistRead','checklistManage','labelsRead','labelsManage','eventsRead','eventsWrite','scheduleRead','scheduleWrite','peopleManage'].map(key => [key,true]));
const targets = {
  FA: ['stations/s','checklists/r','checklistSignatures/s','checklistSignatureRequests/2026-11-08','checklistResponsibilities/day','appConfig/labelStaff','labels/l','labels/l/history/1','eventCatalogs/operational','events/e','events/e/history/1','contacts/AA','eventMembers/AA','scheduleDays/day','vacations/v'],
  FG: ['stations/s','checklists/r','checklistSignatures/s','checklistSignatureRequests/2026-11-08','checklistResponsibilities/day','fgPerformanceReceipts/day','fgPerformanceLedger/l','fgPerformanceSummaries/member','fgPerformanceRuntime/state'],
  FH: ['appConfig/labelStaff','labels/l','labels/l/history/1'],
  FI: ['appConfig/labelStaff','eventCatalogs/operational','events/e','events/e/history/1','contacts/AA','eventMembers/AA'],
  FJ: ['appConfig/labelStaff','eventCatalogs/operational','events/e','events/e/history/1','contacts/AA','eventMembers/AA','scheduleDays/day','vacations/v']
};
const state = disabled => ({schemaVersion:1,revision:1,disabled});
const seed = (station,path,value) => environments[station].withSecurityRulesDisabled(context => setDoc(doc(context.firestore(),path),value));
const removePolicy = station => environments[station].withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(),'runtimePolicy/folders')));
function database(station, uid='member') {
  return environments[station].authenticatedContext(uid, {email:uid+'@example.test',email_verified:true,aud:projects[station],
    sourceProjectId:'sahmt-17a16',moduleStation:station,moduleLeaseExpiresAt:Math.floor(Date.now()/1000)+1800,
    firebase:{sign_in_provider:station==='FA'?'google.com':'custom'}}).firestore();
}
before(async () => {
  const local = /^127\.0\.0\.1:(\d{1,5})$/.exec(process.env.FIRESTORE_EMULATOR_HOST ?? '');
  if (!local) throw Error('OPERATIONAL_POLICY_LOCAL_EMULATOR_REQUIRED');
  for (const station of Object.keys(projects)) {
    const rules = await readFile(new URL(station==='FA'?'../firestore.rules':'../firestore.'+station.toLowerCase()+'.rules',import.meta.url),'utf8');
    environments[station] = await initializeTestEnvironment({projectId:projects[station],firestore:{host:'127.0.0.1',port:Number(local[1]),
      rules:['FA','FJ'].includes(station) ? addFiCutoverRules(rules,station) : rules}});
    await environments[station].clearFirestore();
    if (['FA','FJ'].includes(station)) await seed(station,'fiAdministrativeCutover/current',{active:true});
    for (const uid of ['member','admin']) await seed(station,'users/'+uid,{uid,email:uid+'@example.test',displayName:uid,sigla:'AA',active:true,access:true,role:uid==='admin'?'administrador_app':'anestesiologista',permissions});
    for (const path of targets[station]) await seed(station,path,{active:true,createdByUid:'member',memberSigla:'AA',uid:'member',signerUid:'member',anesthetistSigla:'AA',surgeonSigla:'AA'});
  }
});
after(async () => {for (const environment of Object.values(environments)) await environment.cleanup();});

for (const station of Object.keys(projects)) test(station+' preserves bootstrap reads and blocks operational reads only for members', async () => {
  await removePolicy(station);
  for (const uid of ['member','admin']) {
    const db=database(station,uid);
    for (const path of targets[station]) await assertSucceeds(getDoc(doc(db,path)));
  }
  await seed(station,'runtimePolicy/folders',state(['operacao']));
  for (const uid of ['member','admin']) {
    const db=database(station,uid);
    for (const path of targets[station]) await (uid==='admin'?assertSucceeds:assertFails)(getDoc(doc(db,path)));
    await assertSucceeds(getDoc(doc(db,'users/'+uid)));
  }
  const firstCollection=targets[station][0].split('/')[0];
  if (['FA','FG'].includes(station)) await assertSucceeds(getDocs(collection(database(station,'admin'),firstCollection)));
  await assertFails(getDocs(collection(database(station),firstCollection)));
  await seed(station,'runtimePolicy/folders',state([]));
  await assertSucceeds(getDoc(doc(database(station),targets[station][0])));
});

test('malformed present policy denies reads, while additional publication metadata is accepted', async () => {
  for (const station of Object.keys(projects)) {
    for (const policy of [{}, {...state([]),schemaVersion:2}, {...state([]),revision:0}, {...state([]),revision:1.5}, {...state([]),disabled:{}}]) {
      await seed(station,'runtimePolicy/folders',policy);
      await assertFails(getDoc(doc(database(station),targets[station][0])));
      await assertSucceeds(getDoc(doc(database(station,'admin'),targets[station][0])));
    }
    await seed(station,'runtimePolicy/folders',{...state([]),pending:{revision:2}});
    await assertSucceeds(getDoc(doc(database(station),targets[station][0])));
  }
});

test('FG parent reactivation preserves disabled performance descendants and sibling checklist reads', async () => {
  await seed('FG','runtimePolicy/folders',state(['operacao/checklist','operacao/checklist/desempenho']));
  await assertFails(getDoc(doc(database('FG'),'stations/s')));
  await assertFails(getDoc(doc(database('FG'),'fgPerformanceSummaries/member')));
  await seed('FG','runtimePolicy/folders',state(['operacao/checklist/desempenho']));
  await assertSucceeds(getDoc(doc(database('FG'),'stations/s')));
  await assertFails(getDoc(doc(database('FG'),'fgPerformanceSummaries/member')));
});

test('schedule ancestry blocks vacations and child-only disable leaves schedule and events available', async () => {
  for (const station of ['FA','FJ']) {
    await seed(station,'runtimePolicy/folders',state(['operacao/escala']));
    for (const path of ['scheduleDays/day','vacations/v']) await assertFails(getDoc(doc(database(station),path)));
    await assertSucceeds(getDoc(doc(database(station),'events/e')));
    await seed(station,'runtimePolicy/folders',state(['operacao/escala/ferias']));
    await assertSucceeds(getDoc(doc(database(station),'scheduleDays/day')));
    await assertFails(getDoc(doc(database(station),'vacations/v')));
  }
});

test('individual domain paths block only their own content and histories', async () => {
  for (const station of ['FA','FI','FJ']) {
    for (const [folder,paths] of [['operacao/eventos',['eventCatalogs/operational','events/e','events/e/history/1']],['operacao/pessoas',['contacts/AA','eventMembers/AA']],['operacao/etiquetas',['appConfig/labelStaff']]]) {
      await seed(station,'runtimePolicy/folders',state([folder]));
      for (const path of paths) {
        await assertFails(getDoc(doc(database(station),path)));
        await assertSucceeds(getDoc(doc(database(station,'admin'),path)));
      }
    }
    await seed(station,'runtimePolicy/folders',state(['operacao/eventos-extra']));
    await assertSucceeds(getDoc(doc(database(station),'events/e')));
  }
});

test('policy writes are server-only and FA active-user control reads stay available while disabled', async () => {
  for (const station of Object.keys(projects)) {
    await seed(station,'runtimePolicy/folders',state(['operacao']));
    for (const uid of ['member','admin']) {
      const db=database(station,uid);
      await assertFails(setDoc(doc(db,'runtimePolicy/folders'),state([])));
      await assertFails(deleteDoc(doc(db,'runtimePolicy/folders')));
      const read=getDoc(doc(db,'runtimePolicy/folders'));
      if (['FA','FH'].includes(station)) await assertSucceeds(read); else await assertFails(read);
    }
    await assertFails(getDoc(doc(environments[station].unauthenticatedContext().firestore(),'runtimePolicy/folders')));
  }
  await seed('FA','users/member',{uid:'member',active:false,access:true,permissions});
  await assertFails(getDoc(doc(database('FA'),'runtimePolicy/folders')));
});

test('embedded event and vacation data cannot bypass disabled source folders through schedule',async()=>{for(const station of ['FA','FJ']){await seed(station,'scheduleDays/mixed',{highlights:{events:['e']},vacationLabel:'AA'});for(const folder of ['operacao/eventos','operacao/escala/ferias']){await seed(station,'runtimePolicy/folders',state([folder]));await assertFails(getDoc(doc(database(station),'scheduleDays/mixed')));}}});

test('FH active leased sessions can read only policy control metadata while content is disabled',async()=>{await seed('FH','runtimePolicy/folders',state(['operacao/etiquetas']));for(const uid of ['member','admin']){await assertSucceeds(getDoc(doc(database('FH',uid),'runtimePolicy/folders')));await assertFails(getDocs(collection(database('FH',uid),'runtimePolicy')));await assertFails(setDoc(doc(database('FH',uid),'runtimePolicy/folders'),state([])));}});
