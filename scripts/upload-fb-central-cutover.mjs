import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openPrivateJson,sealPrivateJson} from './lib/windows-protected-json.js';
const dir='.local-preview/fb-performance',candidate=await openPrivateJson(JSON.parse(await readFile(dir+'/central-candidate.dpapi.json','utf8')));
const id='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD';
if(candidate.report.scriptId!==id||!candidate.report.otherFilesUnchanged)throw Error('FB_CENTRAL_CANDIDATE_INVALID');
const path=resolve('../../fc-isolation/.private/google-fa.dpapi.json');let saved=await openPrivateJson(JSON.parse(await readFile(path,'utf8')));
if(saved.alias!=='FA'||saved.email!=='anestesiahmtforms@gmail.com')throw Error('FB_CENTRAL_IDENTITY_INVALID');
const {getAuthorizedOAuth2Client}=await import('../../../fc-isolation/tooling/node_modules/@google/clasp/build/src/auth/auth.js');
const client=await getAuthorizedOAuth2Client({async load(){return saved.credentials;},async save(alias,credentials){if(alias!=='FA')throw Error('FB_CENTRAL_ALIAS_INVALID');saved={...saved,credentials};await writeFile(path,JSON.stringify(await sealPrivateJson(saved)));}},'FA');
async function call(url,method='GET',data){try{return(await client.request({url,method,...(data?{data}:{}),retry:false})).data;}catch(e){throw Error('FB_CENTRAL_HTTP_'+Number(e.response?.status||0));}}
const identity=await call('https://www.googleapis.com/oauth2/v2/userinfo');if(identity.email!==saved.email||identity.verified_email!==true)throw Error('FB_CENTRAL_IDENTITY_MISMATCH');
const sha=files=>createHash('sha256').update(JSON.stringify(files.map(f=>({name:f.name,type:f.type,source:f.source.replaceAll('\r\n','\n')})).sort((a,b)=>a.name.localeCompare(b.name)))).digest('hex');
const base='https://script.googleapis.com/v1/projects/'+id;
const before=await call(base+'/content'),deployments=await call(base+'/deployments');
if(sha(before.files)===candidate.report.candidateSha256){console.log(JSON.stringify({code:'FB_CENTRAL_ALREADY_UPLOADED'}));process.exit(0);}
if(sha(before.files)!==candidate.report.previousSha256)throw Error('FB_CENTRAL_REMOTE_DRIFT');
const changes=new Set(['EvaluationLedger','EvaluationChecklistDelivery','FbCentralCutover']);
for(const file of before.files){const next=candidate.files.find(f=>f.name===file.name);if(!next||next.type!==file.type||!changes.has(file.name)&&next.source!==file.source)throw Error('FB_CENTRAL_UNREVIEWED_CHANGE');}
await writeFile(dir+'/central-before-upload-'+sha(before.files).slice(0,16)+'.dpapi.json',JSON.stringify(await sealPrivateJson({content:before,deployments})));
await call(base+'/content','PUT',{files:candidate.files.map(({name,type,source})=>({name,type,source}))});
const after=await call(base+'/content'),afterDeployments=await call(base+'/deployments');
if(sha(after.files)!==candidate.report.candidateSha256||JSON.stringify(deployments)!==JSON.stringify(afterDeployments))throw Error('FB_CENTRAL_UPLOAD_READBACK_FAILED');
const report={code:'FB_CENTRAL_GUARDS_UPLOADED',scriptId:id,sha256:sha(after.files),existingDeploymentsUnchanged:true,flagsChanged:false,triggersChanged:false,businessWrites:0,at:new Date().toISOString()};
await writeFile(dir+'/central-uploaded.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
