import fs from 'node:fs/promises';
import {verifyPreparedHtmlTrainings} from './prepare-html-trainings.mjs';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {IMPORT_ACCOUNT,initialImportPlan,importInitialDrafts,verifyImportRules} from './lib/html-training-initial-import.js';
import {createFirestoreStore} from '../worker-training/firestore.js';

try{
 const args=process.argv.slice(2);
 if(args.some(arg=>arg!=='--apply')||args.length>1)throw Error('Usage: node scripts/import-html-trainings.mjs [--apply]');
 const apply=args.includes('--apply');
 const verified=await verifyPreparedHtmlTrainings();
 const manifest=JSON.parse(await fs.readFile('.local-preview/html-training-import/manifest.private.json','utf8'));
 const plan=initialImportPlan(manifest,verified);
 const token=await firebaseCliAccountToken(IMPORT_ACCOUNT);
 const rules=await verifyImportRules(token,await fs.readFile('firestore.independent-fb.rules','utf8'));
 const store=createFirestoreStore({getAccessToken:()=>token});
 const report=await importInitialDrafts(store,plan,{apply,onProgress:async progress=>{
  await fs.writeFile('.local-preview/html-training-import-progress.json',JSON.stringify({...progress,apply,at:new Date().toISOString()},null,2)+'\n');
 }});
 const result={...report,...rules,manifestSha256:verified.manifestSha256,completedAt:new Date().toISOString()};
 await fs.writeFile(`.local-preview/html-training-import-${apply?'applied':'dry-run'}.json`,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.code||error.message);process.exitCode=1;}
