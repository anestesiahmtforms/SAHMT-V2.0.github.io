import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {createHtmlTrainingService} from '../worker-training/service.js';
import {IMPORT_ACCOUNT,IMPORT_PROJECT,verifyImportRules} from './lib/html-training-initial-import.js';
import {verifyPreparedHtmlTrainings} from './prepare-html-trainings.mjs';

const args=process.argv.slice(2),apply=args.includes('--apply');
if(args.some(arg=>arg!=='--apply')||args.length>1)throw Error('Usage: node scripts/publish-html-trainings.mjs [--apply]');
const reason='Publicação imediata autorizada pelo administrador em 25/10/2026, com revisão posterior pelo editor do PWA. Gestão somente dos administradores; gestores individuais serão indicados posteriormente.';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const report={projectId:IMPORT_PROJECT,mode:apply?'APPLY':'DRY_RUN',administratorsOnly:true,managerAssignments:0,trainingParticipationWrites:0,scoreWrites:0,items:[]};
const reportPath=`.local-preview/html-training-publication-${apply?'applied':'dry-run'}.json`;
try{
 const verified=await verifyPreparedHtmlTrainings();
 const manifest=JSON.parse(await fs.readFile('.local-preview/html-training-import/manifest.private.json','utf8'));
 const token=await firebaseCliAccountToken(IMPORT_ACCOUNT);
 await verifyImportRules(token,await fs.readFile('firestore.independent-fb.rules','utf8'));
 const response=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${IMPORT_PROJECT}/accounts:lookup`,{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({email:[IMPORT_ACCOUNT]}),signal:AbortSignal.timeout(20000)});
 const user=(await response.json()).users?.[0];
 if(!response.ok||!user||user.disabled||user.email!==IMPORT_ACCOUNT||!user.emailVerified||!user.providerUserInfo?.some(p=>p.providerId==='google.com'))throw Error('PUBLICATION_EXISTING_GOOGLE_ACCOUNT_REQUIRED');
 const store=createFirestoreStore({getAccessToken:()=>token}),service=createHtmlTrainingService({store});
 const profile=await store.get('users',user.localId);
 if(profile?.active!==true||profile.access!==true||!(profile.role==='administrador_app'||profile.permissions?.admin===true))throw Error('PUBLICATION_ADMIN_REQUIRED');
 const identity={uid:user.localId,email:IMPORT_ACCOUNT,emailVerified:true,provider:'google.com'};
 const metadata=await store.getMany('htmlTrainings',manifest.trainings.map(item=>item.trainingId));
 const plan=[];
 for(const [index,item]of manifest.trainings.entries()){
  const training=metadata[index];
  if(training?.status==='PUBLISHED'&&training.managerUid===''&&training.initialImportSha256===verified.manifestSha256){report.items.push({trainingId:item.trainingId,status:'ALREADY_PUBLISHED',version:training.version});continue;}
  if(!training||training.version!==1||training.status!=='DRAFT'||training.managerUid!==''||training.initialImportSha256!==verified.manifestSha256)throw Error('PUBLICATION_BASELINE_CHANGED');
  const editor=await service.execute('EDIT',{trainingId:item.trainingId},identity);
  if(digest(editor.sections)!==digest(item.sections)||digest(editor.bank)!==digest(item.bank))throw Error('PUBLICATION_CONTENT_CHANGED');
  plan.push({...item,training:{...editor.training,status:'PUBLISHED',managerUid:''},expectedVersion:1,
   deferInstitutionalReview:editor.training.source?.pendingInstitutionalReview===true,reviewDeferralReason:reason});
 }
 report.planned=plan.length;report.manifestSha256=verified.manifestSha256;
 await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 if(apply)for(const input of plan){
  const result=await service.execute('PUBLISH',input,identity);
  const content=await service.execute('CONTENT',{trainingId:input.trainingId,version:result.training.version},identity);
  if(result.training.status!=='PUBLISHED'||result.training.managerUid!==''||digest(content.sections)!==digest(input.sections))throw Error('PUBLICATION_READBACK_FAILED');
  report.items.push({trainingId:input.trainingId,status:'PUBLISHED',version:result.training.version,pendingInstitutionalReview:result.training.source?.pendingInstitutionalReview===true});
  await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 }
 report.published=apply?report.items.length:0;report.completedAt=new Date().toISOString();report.verified=true;
 await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({projectId:IMPORT_PROJECT,mode:report.mode,planned:plan.length,published:report.published,administratorsOnly:true,trainingParticipationWrites:0,scoreWrites:0,verified:true}));
}catch(error){report.error=error.code||error.message;await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.error(report.error);process.exitCode=1;}
