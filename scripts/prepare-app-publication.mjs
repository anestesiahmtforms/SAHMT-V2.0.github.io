import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {prepareAppPublication} from './lib/app-publication.js';
if(process.env.GITHUB_REF!=='refs/heads/main'||!['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))throw Error('APP_PUBLICATION_PRODUCTION_ONLY');
let plan;
for(let attempt=0;attempt<4;attempt++){
 try{plan=await prepareAppPublication({repository:process.env.GITHUB_REPOSITORY,sourceRevision:process.env.GITHUB_SHA,token:process.env.GITHUB_TOKEN});break;}
 catch(error){if(error.message!=='APP_PUBLICATION_STATE_MISMATCH'||attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,3000));}
}
const path=resolve('.local-preview/app-publication.json');await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(plan));
if(process.env.GITHUB_ENV)await appendFile(process.env.GITHUB_ENV,'SAHMT_PUBLICATION_FILE='+path+'\n');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'app_version='+plan.appVersion+'\napp_release='+plan.release+'\n');
console.log('APP_PUBLICATION_READY '+plan.appVersion+' '+plan.release+' '+plan.sourceRevision);
