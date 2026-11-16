import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {openPrivateJson,sealPrivateJson} from './lib/windows-protected-json.js';

const project='sahmt-funcional-fk',owner='anestesiahmtaula@gmail.com',apply=process.argv.includes('--apply');
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const normalize=value=>String(value).replaceAll('\r\n','\n').trimEnd();
async function api(token,path,method='GET',body){
 const response=await fetch('https://firebaserules.googleapis.com/v1/projects/'+project+path,{method,
  headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),
  redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('FK_RULES_HTTP_'+response.status);
 return response.json();
}
try{
 const token=await firebaseCliAccountToken(owner),releaseName='/releases/cloud.firestore';
 const [release,candidate]=await Promise.all([api(token,releaseName),readFile(new URL('../firestore.fk.rules',import.meta.url),'utf8')]);
 demand(release.rulesetName?.startsWith('projects/'+project+'/rulesets/'),'FK_RULES_RELEASE_INVALID');
 const rules=await api(token,release.rulesetName.slice(('projects/'+project).length));
 demand(rules.source?.files?.length===1,'FK_RULES_MULTIPLE_FILES_UNREVIEWED');
 const live=rules.source.files[0].content,baseline=execFileSync('git',['show','HEAD:firestore.fk.rules'],{encoding:'utf8'});
 demand(normalize(live)===normalize(baseline)||normalize(live)===normalize(candidate),'FK_RULES_LIVE_DRIFT');
 const summary={project,owner,policyDocument:'runtimePolicy/folders',alreadyCurrent:normalize(live)===normalize(candidate),billingChanged:false};
 if(summary.alreadyCurrent){console.log(JSON.stringify({code:'FK_FOLDER_RULES_CURRENT',...summary}));process.exit(0);}
 if(!apply){console.log(JSON.stringify({code:'FK_FOLDER_RULES_READY',...summary,applyRequired:true}));process.exit(0);}
 demand(process.env.LOCALAPPDATA,'FK_RULES_PRIVATE_BACKUP_PATH_REQUIRED');
 const backupDirectory=resolve(process.env.LOCALAPPDATA,'SAHMT','fk-folder-policy');await mkdir(backupDirectory,{recursive:true});
 const backup=resolve(backupDirectory,'FK-rules-'+Date.now()+'-'+randomUUID()+'.dpapi.json');
 const snapshot={schemaVersion:1,project,release,rules,createdAt:new Date().toISOString()};
 await writeFile(backup,JSON.stringify(await sealPrivateJson(snapshot)),{flag:'wx',mode:0o600});
 const verified=await openPrivateJson(JSON.parse(await readFile(backup,'utf8')));
 demand(verified.project===project,'FK_RULES_BACKUP_PROJECT_VERIFY_FAILED');
 demand(normalize(verified.rules?.source?.files?.[0]?.content)===normalize(live),'FK_RULES_BACKUP_CONTENT_VERIFY_FAILED');
 const created=await api(token,'/rulesets','POST',{source:{files:[{name:rules.source.files[0].name,content:candidate}]}});
 demand(created.name?.startsWith('projects/'+project+'/rulesets/'),'FK_RULES_CREATED_RESOURCE_INVALID');
 const latest=await api(token,releaseName);
 demand(latest.rulesetName===release.rulesetName&&latest.updateTime===release.updateTime,'FK_RULES_RELEASE_DRIFT');
 await api(token,releaseName,'PATCH',{release:{name:release.name,rulesetName:created.name},updateMask:'rulesetName'});
 const after=await api(token,releaseName),published=await api(token,after.rulesetName.slice(('projects/'+project).length));
 demand(after.rulesetName===created.name&&published.source?.files?.length===1&&normalize(published.source.files[0].content)===normalize(candidate),'FK_RULES_POSTCHECK_FAILED');
 console.log(JSON.stringify({code:'FK_FOLDER_RULES_PUBLISHED',...summary,backup,release:after.rulesetName}));
}catch(error){console.error(/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'FK_FOLDER_RULES_PUBLISH_FAILED');process.exitCode=1;}
