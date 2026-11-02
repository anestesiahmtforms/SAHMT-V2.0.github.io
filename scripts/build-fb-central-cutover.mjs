import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openPrivateJson,sealPrivateJson} from './lib/windows-protected-json.js';
const scriptId='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD',file=resolve('../../fc-isolation/.private/google-fa.dpapi.json');
let saved=await openPrivateJson(JSON.parse(await readFile(file,'utf8')));
if(saved.alias!=='FA'||saved.email!=='anestesiahmtforms@gmail.com')throw Error('FB_CENTRAL_IDENTITY_MISMATCH');
const {getAuthorizedOAuth2Client}=await import('../../../fc-isolation/tooling/node_modules/@google/clasp/build/src/auth/auth.js');
const client=await getAuthorizedOAuth2Client({async load(){return saved.credentials;},async save(alias,credentials){if(alias!=='FA')throw Error('FB_CENTRAL_ALIAS_INVALID');saved={...saved,credentials};await writeFile(file,JSON.stringify(await sealPrivateJson(saved)));}},'FA');
const identity=(await client.request({url:'https://www.googleapis.com/oauth2/v2/userinfo'})).data;
if(identity.email!==saved.email||identity.verified_email!==true)throw Error('FB_CENTRAL_IDENTITY_MISMATCH');
const previous=(await client.request({url:'https://script.googleapis.com/v1/projects/'+scriptId+'/content'})).data;
const files=structuredClone(previous.files),changed=[];
function patch(name,start,end,needle,replacement){
 const file=files.find(f=>f.name===name);if(!file)throw Error('FB_CENTRAL_FILE_MISSING');
 const a=file.source.indexOf(start),b=end?file.source.indexOf(end,a):file.source.length;if(a<0||b<a)throw Error('FB_CENTRAL_FUNCTION_MISSING');
 const segment=file.source.slice(a,b);if(segment.includes(replacement))return;if(segment.split(needle).length!==2)throw Error('FB_CENTRAL_ANCHOR_AMBIGUOUS');
 file.source=file.source.slice(0,a)+segment.replace(needle,replacement)+file.source.slice(b);changed.push(name);
}
patch('EvaluationLedger','function evaluationApplyAwards_','function applyEvaluationAwardDesired_',
 'changes.forEach(function (input) {','changes.forEach(function (input) {\n    if(typeof fbOnlyAssertNativeAward_===\'function\')fbOnlyAssertNativeAward_(input,transaction);');
patch('EvaluationChecklistDelivery','function evaluationQueueChecklistDelivery_','function evaluationDeliverChecklistEvent_',
 'function evaluationQueueChecklistDelivery_(signature, requestId, transaction) {',"function evaluationQueueChecklistDelivery_(signature, requestId, transaction) {\n  if(typeof fbOnlyCentralEnabled_==='function'&&fbOnlyCentralEnabled_())return {status:'FB_ONLY_EXCLUDED',writes:[]};");
patch('EvaluationChecklistDelivery','function evaluationDeliverChecklistEvent_',null,
 'function evaluationDeliverChecklistEvent_(id, options) {',"function evaluationDeliverChecklistEvent_(id, options) {\n  if(typeof fbOnlyCentralEnabled_==='function'&&fbOnlyCentralEnabled_())return {status:'FB_ONLY_EXCLUDED',pointsAwarded:0};");
const helper={name:'FbCentralCutover',type:'SERVER_JS',source:await readFile('apps-script-v2/FbCentralCutover.gs','utf8')};
const existing=files.find(f=>f.name===helper.name);if(existing){if(existing.source!==helper.source){existing.source=helper.source;changed.push(helper.name);}}else files.push(helper);
const sha=files=>createHash('sha256').update(JSON.stringify(files.map(f=>({name:f.name,type:f.type,source:f.source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name)))).digest('hex');
const report={code:'FB_CENTRAL_CANDIDATE_PREPARED',scriptId,previousSha256:sha(previous.files),candidateSha256:sha(files),changedExistingFiles:[...new Set(changed)],newFile:existing?null:'FbCentralCutover',existingFcCutoverPreserved:true,otherFilesUnchanged:true,uploaded:false,flagsChanged:false,triggersChanged:false,businessWrites:0,at:new Date().toISOString()};
const dir='.local-preview/fb-performance';await mkdir(dir,{recursive:true});await writeFile(dir+'/central-candidate.dpapi.json',JSON.stringify(await sealPrivateJson({previous,files,report})));
await writeFile('docs/superpowers/reports/2026-11-02-fb-central-candidate.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
