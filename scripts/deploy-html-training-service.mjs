import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createServiceTokenProvider} from '../worker-training/google-auth.js';
import {createFirestoreStore} from '../worker-training/firestore.js';
import {IMPORT_PROJECT,IMPORT_ACCOUNT,verifyImportRules} from './lib/html-training-initial-import.js';

const accountId='679464db2379db8562b62ae982f30471';
const serviceEmail=`html-training-worker@${IMPORT_PROJECT}.iam.gserviceaccount.com`;
const roleName=`projects/${IMPORT_PROJECT}/roles/htmlTrainingWorker`;
const permissions=['datastore.databases.get','datastore.entities.create','datastore.entities.get','datastore.entities.list','datastore.entities.update'];
const reportPath='.local-preview/html-training-deployment.json';
if(process.argv.length!==2)throw Error('Usage: node scripts/deploy-html-training-service.mjs');
const report={projectId:IMPORT_PROJECT,accountId,serviceEmail,roleName,permissions,mode:'DRY_RUN',stages:[],enabled:false};
async function stage(name){report.stages.push({name,at:new Date().toISOString()});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
function wrangler(args,input){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{env:{...process.env,
  CLOUDFLARE_ACCOUNT_ID:accountId,WRANGLER_LOG:args[0]==='deploy'?'info':'error',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:'.local-preview/wrangler-training-deploy.log'},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 child.on('error',()=>reject(Error('DEPLOY_WRANGLER_START_FAILED')));
 child.on('close',code=>{if(code!==0)reject(Error('DEPLOY_WRANGLER_FAILED_'+args[0]));else resolve(output);});
 child.stdin.on('error',()=>{});child.stdin.end(input);
});}

try {
 const identity=JSON.parse(await wrangler(['whoami','--json']));
 if(identity.loggedIn!==true||identity.email!==IMPORT_ACCOUNT||!identity.accounts?.some(account=>account.id===accountId))throw Error('DEPLOY_CLOUDFLARE_ACCOUNT_MISMATCH');
 const token=await firebaseCliAccountToken(IMPORT_ACCOUNT);
 const rules=await verifyImportRules(token,await fs.readFile('firestore.independent-fb.rules','utf8'));
 Object.assign(report,rules);
 await stage('AUTH_AND_RULES_VERIFIED');
 console.log(JSON.stringify(report,null,2));
}catch(error){
 report.error=error.message;
 await stage('FAILED');
 console.error(report.error);
 process.exitCode=1;
}
