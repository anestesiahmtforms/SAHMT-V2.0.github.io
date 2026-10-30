import fs from 'node:fs/promises';
import {canonicalDigest} from './lib/reading-plan-migration.js';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {IMPORT_ACCOUNT,IMPORT_PROJECT,verifyImportRules} from './lib/html-training-initial-import.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {buildReadingPlan} from '../worker-training/reading-plan.js';
import {documentSize} from '../worker-training/domain-validation.js';
const args=process.argv.slice(2),apply=args.includes('--apply');
if(args.length>1||args.some(a=>a!=='--apply'))throw Error('USE_DRY_RUN_OR_APPLY');
const dir='.local-preview/complete-reading';await fs.mkdir(dir,{recursive:true});
const hash=canonicalDigest;
const token=await firebaseCliAccountToken(IMPORT_ACCOUNT),store=createFirestoreStore({getAccessToken:()=>token});
await verifyImportRules(token,await fs.readFile('firestore.independent-fb.rules','utf8'));
const all=await store.list('htmlTrainings',[],1000),trainings=all.filter(t=>t.status==='PUBLISHED');
if(trainings.length!==66)throw Error('CATALOG_COUNT_CHANGED_REVIEW_REQUIRED');
const snapshots=await store.getMany('htmlTrainingVersions',trainings.map(t=>`${t.id}_v${t.version}`)),plan=[];
for(const [i,t]of trainings.entries()){
 const v=snapshots[i];if(!v||v.trainingId!==t.id||v.version!==t.version)throw Error('VERSION_MISMATCH');
 const chunks=await store.getMany('htmlTrainingContent',Array.from({length:v.chunkCount},(_,n)=>`${t.id}_v${t.version}_p${n}`));
 const sections=v.contentEncoding==='JSON_UTF8_CHUNKS_V1'?JSON.parse(chunks.map(c=>c.part).join('')):chunks.flatMap(c=>c.sections);
 const reading=buildReadingPlan(sections);documentSize(reading,700000);
 if(!reading.blocks.length)throw Error('MATERIAL_WITHOUT_READABLE_CONTENT');
 plan.push({id:`${t.id}_v${t.version}`,trainingId:t.id,version:t.version,metadataSha256:hash(t),snapshotSha256:hash(v),reading:{...reading,trainingId:t.id,trainingVersion:t.version,contentSha256:hash(sections)}});
}
const manifestSha256=hash(plan);
if(apply){const dry=JSON.parse(await fs.readFile(`${dir}/dry-run.json`,'utf8'));if(dry.manifestSha256!==manifestSha256||!dry.verified)throw Error('DRY_RUN_CHANGED');}
await fs.writeFile(`${dir}/plans.private.json`,JSON.stringify(plan,null,2));
let created=0;
if(apply)for(const p of plan)await store.transaction(async tx=>{
 const t=await tx.get('htmlTrainings',p.trainingId),v=await tx.get('htmlTrainingVersions',p.id),existing=await tx.get('htmlTrainingReadingPlans',p.id);
 if(hash(t)!==p.metadataSha256||hash(v)!==p.snapshotSha256)throw Error('MATERIAL_CHANGED_DURING_PREPARATION');
 if(existing){if(hash(existing)!==hash(p.reading))throw Error('EXISTING_PLAN_CONFLICT');return;}
 tx.create('htmlTrainingReadingPlans',p.id,p.reading);created++;
});
if(apply){
 const actual=await store.getMany('htmlTrainingReadingPlans',plan.map(p=>p.id));
 if(actual.some((r,i)=>hash(r)!==hash(plan[i].reading)))throw Error('PLAN_READBACK_FAILED');
 const after=await store.list('htmlTrainings',[],1000);if(hash(after)!==hash(all))throw Error('CATALOG_CHANGED_DURING_PREPARATION');
}
const report={projectId:IMPORT_PROJECT,mode:apply?'APPLY':'DRY_RUN',materials:plan.length,created,manifestSha256,minimumMinutes:Math.round(Math.min(...plan.map(p=>p.reading.totalRequiredMs))/6000)/10,maximumMinutes:Math.round(Math.max(...plan.map(p=>p.reading.totalRequiredMs))/6000)/10,materialWrites:0,participationWrites:0,scoreWrites:0,verified:true,completedAt:new Date().toISOString()};
await fs.writeFile(`${dir}/${apply?'applied':'dry-run'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
