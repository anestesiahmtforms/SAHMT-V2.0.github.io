import {isDeepStrictEqual} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {openPrivateJson,sealPrivateJson} from './lib/windows-protected-json.js';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {google} from './lib/fd-fe-release.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {vacationServiceToken,createVacationSheets} from '../worker-fe-vacations/google.js';
import {vacationSnapshot,assertVacationSnapshot,vacationHash} from '../worker-fe-vacations/snapshot.js';
const apply=process.argv.includes('--apply'),dir='.local-preview/vacations-firestore';mkdirSync(dir,{recursive:true});
const credentials=await openPrivateJson(JSON.parse(readFileSync('../fd-fe-performance/.local-preview/fd-fe-release/FE-service-key.dpapi.json','utf8')));
const getAccessToken=vacationServiceToken({credentials,includeSheets:true}),sheets=createVacationSheets({getAccessToken}),store=createFirestoreStore({projectId:'outros-48120',getAccessToken});
const owner=await firebaseCliAccountToken('anestesiahmtforms5@gmail.com');if((await google('https://cloudbilling.googleapis.com/v1/projects/outros-48120/billingInfo',owner)).billingEnabled!==false)throw Error('BILLING_DISABLED_REQUIRED');
const existing=await store.get('vacations2027Schedules','current');if(existing){assertVacationSnapshot(existing);console.log(JSON.stringify({code:'VACATIONS_FIRESTORE_ALREADY_PREPARED',revision:existing.revision}));process.exit(0);}
const lease='migration-'+crypto.randomUUID();if(apply)await store.transaction(async tx=>{const lock=await tx.get('vacations2027Locks','sheet');if(lock?.until>Date.now())throw Error('VACATIONS_MIGRATION_BUSY');tx.set('vacations2027Locks','sheet',{owner:lease,until:Date.now()+15*60000,purpose:'FIRESTORE_CUTOVER'});});
const started=performance.now(),[data,history]=await Promise.all([sheets.read(),sheets.audit()]),sourceReadMs=Math.round(performance.now()-started),snapshot=assertVacationSnapshot(await vacationSnapshot(data));
writeFileSync(dir+'/source-before.dpapi.json',JSON.stringify(await sealPrivateJson({data,history,at:new Date().toISOString()})));
if(apply)await store.transaction(async tx=>{const [lock,current,oldHistory]=await Promise.all([tx.get('vacations2027Locks','sheet'),tx.get('vacations2027Schedules','current'),tx.get('vacations2027History','current')]);if(lock?.owner!==lease||lock.until<Date.now()||current||oldHistory)throw Error('VACATIONS_MIGRATION_CONFLICT');tx.create('vacations2027Schedules','current',snapshot);tx.create('vacations2027History','current',{schemaVersion:2,rows:history.slice(0,200),source:'DRIVE_IMPORT'});tx.create('vacations2027Migrations','driveToFirestoreV1',{schemaVersion:1,sourceHash:await vacationHash(data),snapshotVersion:snapshot.version,createdAt:Date.now(),source:snapshot.source,previousService:'SHEETS',storage:'FIRESTORE'});});
if(apply){const verified=assertVacationSnapshot(await store.get('vacations2027Schedules','current'));if(verified.version!==snapshot.version||!isDeepStrictEqual(verified.months,snapshot.months))throw Error('VACATIONS_MIGRATION_READBACK_FAILED');}
const report={code:apply?'VACATIONS_FIRESTORE_PREPARED':'VACATIONS_FIRESTORE_PREVIEW',months:snapshot.months.length,weeks:snapshot.months.reduce((n,m)=>n+m.weeks.length,0),siglas:snapshot.siglas.length,filledSlots:snapshot.months.flatMap(m=>m.weeks.flatMap(w=>w.slots)).filter(s=>s.value).length,importedAuditRows:history.length,sourceReadMs,version:snapshot.version,bookingsChanged:0,sheetWrites:0,billingEnabled:false,at:new Date().toISOString()};writeFileSync(dir+'/migration-status.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
