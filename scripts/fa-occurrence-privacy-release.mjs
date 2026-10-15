import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFaRuleReleaseClient} from './lib/fa-rule-release-client.js';
import {prepareOccurrenceLedgerPrivacyRules,localizeOccurrenceFaRules} from './lib/occurrence-fa-rules.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');
try{
 const apply=process.argv.length===3&&process.argv[2]==='--apply';
 demand(process.argv.length===2||apply,'CONSOLIDATION_PRIVACY_ARGUMENT_INVALID');
 const token=await firebaseCliAccountToken('anestesiahmtforms@gmail.com');
 const client=createFaRuleReleaseClient({projectId:'sahmt-17a16',accessToken:token});
 if(!apply){
  const before=await client.read(),original=before.rules.source.files[0].content;
  demand(original.includes('function faDomainOpen_')&&original.includes('BEGIN OCCURRENCES_FA_V1'),'CONSOLIDATION_PRIVACY_EXISTING_GATE_REQUIRED');
  const content=localizeOccurrenceFaRules(prepareOccurrenceLedgerPrivacyRules(original));
  demand(content!==original,'CONSOLIDATION_PRIVACY_ALREADY_INSTALLED');
  const protector=await createPrivateJsonProtector();
  await writeFile(resolve(dir,'FA-occurrence-privacy-'+Date.now()+'.dpapi.json'),JSON.stringify(protector.seal({before,content,sha256:digest(content)})),{mode:0o600});
  // Rules contain no identities or credentials. Private emulator input only.
  await writeFile(resolve(dir,'FA-occurrence-privacy-prepared.rules'),content,{mode:0o600});
  console.log(JSON.stringify({code:'FA_OCCURRENCE_PRIVACY_PREPARED',remoteChanges:0,protectedCollections:2,unrelatedRulesPreserved:true}));
 }else{
  const file=(await readdir(dir)).filter(x=>/^FA-occurrence-privacy-\d+\.dpapi.json$/.test(x)).sort().at(-1);
  demand(file,'CONSOLIDATION_PRIVACY_BACKUP_REQUIRED');
  const prepared=await openPrivateJson(JSON.parse(await readFile(resolve(dir,file),'utf8')));
  demand(digest(prepared.content)===prepared.sha256&&digest(await readFile(resolve(dir,'FA-occurrence-privacy-prepared.rules'),'utf8'))===prepared.sha256,'CONSOLIDATION_PRIVACY_CONTENT_CHANGED');
  const release=await client.publish(prepared.content,prepared.before);
  demand((await client.read()).rules.source.files[0].content===prepared.content,'CONSOLIDATION_PRIVACY_POSTCHECK_FAILED');
  const protector=await createPrivateJsonProtector();
  await writeFile(resolve(dir,'FA-occurrence-privacy-activation-'+Date.now()+'.dpapi.json'),JSON.stringify(protector.seal({release,sha256:prepared.sha256,backup:file})),{mode:0o600});
  console.log(JSON.stringify({code:'FA_OCCURRENCE_PRIVACY_ACTIVE',protectedCollections:2,unrelatedRulesPreserved:true,userChanges:0}));
 }
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_PRIVACY_FAILED',automaticRetry:false}));process.exitCode=1;}
