import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {googleFaPerformanceClient,FA_SCRIPT} from './lib/google-fa-performance-client.js';
import {sealPrivateJson} from './lib/windows-protected-json.js';
const {request}=await googleFaPerformanceClient(),base='https://script.googleapis.com/v1/projects/'+FA_SCRIPT,dir='.local-preview/fa-performance';
await mkdir(dir,{recursive:true});const before=await request(base+'/content'),deployments=await request(base+'/deployments'),files=structuredClone(before.files),changed=[];
function patch(name,needle,replacement){const f=files.find(f=>f.name===name);if(!f)throw Error('FA_CENTRAL_FILE_MISSING');if(f.source.includes(replacement))return;if(f.source.split(needle).length!==2)throw Error('FA_CENTRAL_ANCHOR_AMBIGUOUS');f.source=f.source.replace(needle,replacement);changed.push(name);}
patch('ChecklistValidation','transfer = evaluationProject_() === SAHMT_EVALUATION_FB',"transfer = typeof faPerformanceOnly_ === 'function' && faPerformanceOnly_()\n        ? {status: 'FA_ONLY_PENDING', writes: []}\n        : evaluationProject_() === SAHMT_EVALUATION_FB");
patch('EvaluationChecklistDelivery','function evaluationQueueChecklistDelivery_(signature, requestId, transaction) {',"function evaluationQueueChecklistDelivery_(signature, requestId, transaction) {\n  if(typeof faPerformanceOnly_==='function'&&faPerformanceOnly_())return {status:'FA_ONLY_EXCLUDED',writes:[]};");
patch('EvaluationChecklistDelivery','function evaluationDeliverChecklistEvent_(id, options) {',"function evaluationDeliverChecklistEvent_(id, options) {\n  if(typeof faPerformanceOnly_==='function'&&faPerformanceOnly_())return {status:'FA_ONLY_EXCLUDED',pointsAwarded:0};");
for(const name of ['FaPerformance','FaPerformanceDomain']){const source=await readFile('apps-script-v2/'+name+'.gs','utf8'),existing=files.find(f=>f.name===name);if(existing){if(existing.source!==source){existing.source=source;changed.push(name);}}else{files.push({name,type:'SERVER_JS',source});changed.push(name);}}
const sha=files=>createHash('sha256').update(JSON.stringify(files.map(f=>({name:f.name,type:f.type,source:f.source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name)))).digest('hex');
const report={scriptId:FA_SCRIPT,previousSha256:sha(before.files),candidateSha256:sha(files),changedFiles:[...new Set(changed)],existingDeploymentsUnchanged:true,manifestUnchanged:true,otherFilesUnchanged:true,at:new Date().toISOString()};
const allow=new Set(['ChecklistValidation','EvaluationChecklistDelivery','FaPerformance','FaPerformanceDomain']);
for(const f of before.files){const next=files.find(n=>n.name===f.name);if(!next||!allow.has(f.name)&&(next.source!==f.source||next.type!==f.type))throw Error('FA_UNREVIEWED_CHANGE');}
await writeFile(dir+'/central-candidate.dpapi.json',JSON.stringify(await sealPrivateJson({before,deployments,files,report})));
if(!process.argv.includes('--apply')){console.log(JSON.stringify({code:'FA_CENTRAL_CANDIDATE_READY',...report,uploaded:false}));process.exit(0);}
const latest=await request(base+'/content');if(sha(latest.files)!==report.previousSha256)throw Error('FA_CENTRAL_REMOTE_DRIFT');
if(report.previousSha256!==report.candidateSha256)await request(base+'/content','PUT',{files:files.map(({name,type,source})=>({name,type,source}))});
const after=await request(base+'/content'),afterDeployments=await request(base+'/deployments');if(sha(after.files)!==report.candidateSha256||JSON.stringify(deployments)!==JSON.stringify(afterDeployments))throw Error('FA_CENTRAL_READBACK_FAILED');
await writeFile(dir+'/central-uploaded.json',JSON.stringify(report,null,2));console.log(JSON.stringify({code:'FA_CENTRAL_UPLOADED',...report,activated:false}));
