import fs from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {IMPORT_ACCOUNT,IMPORT_PROJECT,verifyImportRules} from './lib/html-training-initial-import.js';
import {planTrainingOrganization,applyTrainingOrganization} from './lib/html-training-organization.js';
const args=process.argv.slice(2),apply=args.includes('--apply');
if(args.some(arg=>arg!=='--apply')||args.length>1)throw Error('Usage: node scripts/organize-html-trainings.mjs [--apply]');
try{
 const token=await firebaseCliAccountToken(IMPORT_ACCOUNT);
 await verifyImportRules(token,await fs.readFile('firestore.independent-fb.rules','utf8'));
 const response=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${IMPORT_PROJECT}/accounts:lookup`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({email:[IMPORT_ACCOUNT]}),signal:AbortSignal.timeout(20000)});
 const data=await response.json(),actor=data.users?.length===1?data.users[0]:null;
 if(!response.ok||!actor||actor.disabled||!actor.emailVerified||actor.email!==IMPORT_ACCOUNT)throw Error('ORGANIZATION_ACTOR_INVALID');
 const store=createFirestoreStore({getAccessToken:()=>token}),records=await store.list('htmlTrainings',[],1000);
 const mapping=JSON.parse(await fs.readFile('.local-preview/html-training-folder-map.json','utf8'));
 const plan=planTrainingOrganization(records,mapping);
 const report={projectId:IMPORT_PROJECT,mode:apply?'APPLY':'DRY_RUN',planned:plan.length,counts:mapping.reduce((out,row)=>{out[row.subcategory]=(out[row.subcategory]||0)+1;return out;},{}),permissionChanges:0};
 if(apply){
  Object.assign(report,await applyTrainingOrganization(store,plan,{uid:actor.localId}));
  const actual=await store.getMany('htmlTrainings',plan.map(item=>item.trainingId));
  for(const [index,item]of plan.entries()){
   const before=records.find(row=>row.id===item.trainingId),after=actual[index];
   if(after.subcategory!==item.subcategory||after.version!==before.version||after.audienceGroup!==before.audienceGroup||after.managerUid!==before.managerUid||after.status!==before.status)throw Error('ORGANIZATION_READBACK_FAILED');
  }
 }
 report.verified=true;report.completedAt=new Date().toISOString();
 await fs.writeFile(`.local-preview/html-training-organization-${apply?'applied':'dry-run'}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,trainingIds:undefined}));
}catch(error){console.error(error.code||error.message);process.exitCode=1;}
