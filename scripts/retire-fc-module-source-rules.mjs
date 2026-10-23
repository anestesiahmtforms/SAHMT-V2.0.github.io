import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFaRuleReleaseClient} from './lib/fa-rule-release-client.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {retireFcSourceRules} from './lib/fc-source-retirement-rules.js';
const demand=(ok,code)=>{if(!ok)throw Error(code);};let changed=false;
async function main(){
 const mode=process.argv[2]||'preview';demand(['preview','apply'].includes(mode),'FC_RETIREMENT_MODE_INVALID');
 const token=await firebaseCliAccountToken('anestesiahmtforms@gmail.com');
 const client=createFaRuleReleaseClient({projectId:'sahmt-17a16',accessToken:token}),live=await client.read();
 const source=live.rules.source.files[0].content,directory=resolve(process.env.LOCALAPPDATA,'SAHMT','qmentum-fc-migration');await mkdir(directory,{recursive:true});
 const protector=await createPrivateJsonProtector();
 if(mode==='preview'){
  const candidate=retireFcSourceRules(source,{requireBoth:true});
  const state={schemaVersion:1,projectId:'sahmt-17a16',destinationProjectId:'indicadores---sahmt',previous:live,candidate:candidate.source,createdAt:new Date().toISOString()};
  const backup=resolve(directory,'FA-module-fence-preview-'+Date.now()+'.dpapi.json');await writeFile(backup,JSON.stringify(protector.seal(state)),{flag:'wx',mode:0o600});
  demand(snapshotDigest(protector.open(JSON.parse(await readFile(backup,'utf8'))))===snapshotDigest(state),'FC_RETIREMENT_BACKUP_INVALID');
  await mkdir('.local-preview',{recursive:true});await writeFile('.local-preview/fa-retired-module.rules',candidate.source);
  console.log(JSON.stringify({code:'FC_SOURCE_RETIREMENT_PREVIEW',removedSections:candidate.removed,candidateSha256:snapshotDigest(candidate.source),remoteWrites:0,backup}));return;
 }
 const name=(await readdir(directory)).filter(n=>/^FA-module-fence-preview-\d+\.dpapi\.json$/.test(n)).sort().at(-1);demand(name,'FC_RETIREMENT_PREVIEW_REQUIRED');
 const state=await openPrivateJson(JSON.parse(await readFile(resolve(directory,name),'utf8')));
 demand(state.projectId==='sahmt-17a16'&&state.destinationProjectId==='indicadores---sahmt'&&state.previous.rules.source.files[0].content===source,'FC_RETIREMENT_LIVE_RULE_DRIFT');
 demand(retireFcSourceRules(source,{requireBoth:true}).source===state.candidate,'FC_RETIREMENT_CANDIDATE_DRIFT');
 changed=true;const released=await client.publish(state.candidate,live),after=await client.read();
 demand(after.rules.source.files[0].content===state.candidate,'FC_RETIREMENT_RULE_POSTCHECK_FAILED');
 const evidence={schemaVersion:1,projectId:state.projectId,destinationProjectId:state.destinationProjectId,installedRulesSha256:snapshotDigest(state.candidate),rulesetName:released.rulesetName,appliedAt:new Date().toISOString(),backup:name};
 const file=resolve(directory,'FA-module-fence-applied-'+Date.now()+'.dpapi.json');await writeFile(file,JSON.stringify(protector.seal(evidence)),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({code:'FC_SOURCE_RULES_RETIRED',rulesetName:released.rulesetName,remoteWrites:1,sourceDeletes:0,quiescenceAfter:new Date(Date.parse(evidence.appliedAt)+7*60*1000).toISOString()}));
}
main().catch(e=>{console.error(JSON.stringify({code:/^FC_RETIREMENT_[A-Z0-9_]+$/.test(e.message||'')?e.message:'FC_RETIREMENT_RULE_OPERATION_FAILED',remoteChangesPossible:changed}));process.exitCode=1;});
