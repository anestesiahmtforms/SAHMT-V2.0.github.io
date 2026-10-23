import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFaRuleReleaseClient} from './lib/fa-rule-release-client.js';
import {createPrivateJsonProtector} from './lib/windows-protected-json.js';

const PROJECT='indicadores---sahmt';
const demand=(ok,code)=>{if(!ok)throw Error(code);};
async function getJson(token,url){
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
 demand(response.ok,'FC_RULES_PREFLIGHT_HTTP_'+response.status);return response.json();
}
async function main(){
 demand(process.env.LOCALAPPDATA,'FC_RULES_PRIVATE_BACKUP_PATH_REQUIRED');
 const token=await firebaseCliAccountToken('anestesiahmtforms3@gmail.com');
 const billing=await getJson(token,'https://cloudbilling.googleapis.com/v1/projects/'+PROJECT+'/billingInfo');
 demand(billing.billingEnabled===false,'FC_RULES_BILLING_ENABLED');
 const client=createFaRuleReleaseClient({projectId:PROJECT,accessToken:token});
 const previous=await client.read();
 const current=previous.rules.source.files[0].content;
 const candidate=await readFile(new URL('../firestore.fc.rules',import.meta.url),'utf8');
 const collections=[...new Set([...current.matchAll(/match \/([^/{$]+)\//g)].map(match=>match[1]))];
 demand(collections.every(name=>candidate.includes('match /'+name+'/')),'FC_RULES_EXISTING_COLLECTION_DROPPED');
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fc-migration');
 await mkdir(directory,{recursive:true});
 const protector=await createPrivateJsonProtector();
 const backup=resolve(directory,'FC-rules-'+Date.now()+'-'+randomUUID()+'.dpapi.json');
 const snapshot={schemaVersion:1,project:PROJECT,release:previous.release,rules:previous.rules,billingEnabled:false,createdAt:new Date().toISOString()};
 await writeFile(backup,JSON.stringify(protector.seal(snapshot)),{flag:'wx',mode:0o600});
 const opened=protector.open(JSON.parse(await readFile(backup,'utf8')));
 demand(opened.project===PROJECT&&opened.rules.source.files[0].content===current,'FC_RULES_BACKUP_VERIFY_FAILED');
 if(current===candidate){
  console.log(JSON.stringify({code:'FC_MODULE_RULES_ALREADY_CURRENT',project:PROJECT,collectionsPreserved:collections.length,billingEnabled:false,remoteWrites:0,privateBackup:backup}));
  return;
 }
 const deployed=await client.publish(candidate,previous);
 demand(deployed.rulesetName!==previous.release.rulesetName,'FC_RULES_RELEASE_NOT_CHANGED');
 const verified=await client.read();
 demand(verified.release.rulesetName===deployed.rulesetName&&verified.rules.source.files[0].content===candidate,'FC_RULES_POSTCHECK_FAILED');
 console.log(JSON.stringify({code:'FC_MODULE_RULES_PUBLISHED',project:PROJECT,collectionsPreserved:collections.length,billingEnabled:false,release:deployed.name,remoteWrites:1,privateBackup:backup}));
}
main().catch(error=>{
 const code=/^FC_RULES_[A-Z0-9_]+$/.test(error.message||'')?error.message:'FC_MODULE_RULES_PUBLISH_FAILED';
 console.error(JSON.stringify({code,changed:false}));process.exitCode=1;
});
