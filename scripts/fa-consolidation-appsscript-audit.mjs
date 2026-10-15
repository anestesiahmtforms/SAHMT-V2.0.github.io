import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {createPrivateJsonProtector} from './lib/windows-protected-json.js';import {snapshotDigest} from './lib/management-split-plan.js';
try{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),directory=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');
 await mkdir(directory,{recursive:true});const protector=await createPrivateJsonProtector();
 const credentials=JSON.parse(await readFile(resolve(process.env.USERPROFILE,'.clasprc.json'),'utf8')).tokens?.default;
 const target=JSON.parse(await readFile(resolve(process.env.USERPROFILE,'Documents','ChatGPT','FIRESTORE','apps-script-v2','.clasp.json'),'utf8'));
 if(!credentials?.refresh_token||!target.scriptId)throw Error('CONSOLIDATION_SCRIPT_SESSION_MISSING');
 let token=credentials.access_token;
 if(!token||credentials.expiry_date<Date.now()+60000){
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:credentials.client_id,client_secret:credentials.client_secret,refresh_token:credentials.refresh_token,grant_type:'refresh_token'}),
   redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('CONSOLIDATION_SCRIPT_REAUTH_REQUIRED');token=(await response.json()).access_token;
 }
 const get=async(path)=>{
  const response=await fetch(path,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('CONSOLIDATION_SCRIPT_HTTP_'+response.status);return response.json();
 };
 const identity=await get('https://www.googleapis.com/oauth2/v2/userinfo');
 if(identity.email!=='anestesiahmtforms@gmail.com'||identity.verified_email!==true)throw Error('CONSOLIDATION_SCRIPT_IDENTITY_MISMATCH');
 const base='https://script.googleapis.com/v1/projects/'+encodeURIComponent(target.scriptId),metadata=await get(base),content=await get(base+'/content'),deployments=await get(base+'/deployments');
 if(!Array.isArray(content.files)||!/integra.*spark/i.test(metadata.title))throw Error('CONSOLIDATION_SCRIPT_TARGET_MISMATCH');
 const comparisons=[];
 for(const name of await readdir(resolve(root,'apps-script-v2'))){
  if(!name.endsWith('.gs'))continue;const local=(await readFile(resolve(root,'apps-script-v2',name),'utf8')).replaceAll('\r\n','\n');
  const remote=content.files.find(file=>file.type==='SERVER_JS'&&file.name===name.slice(0,-3));
  comparisons.push({file:name,existsRemotely:Boolean(remote),matchesLocal:remote?.source?.replaceAll('\r\n','\n')===local});
 }
 const probeResponse=await fetch('https://script.googleapis.com/v1/scripts/'+encodeURIComponent(target.scriptId)+':run',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({function:'evaluationProject_',parameters:[],devMode:true}),redirect:'error',signal:AbortSignal.timeout(30000)});
 const runtimeProbe={httpStatus:probeResponse.status};
 if(probeResponse.ok){const operation=await probeResponse.json();runtimeProbe.completed=operation.done===true;
  if(operation.error)runtimeProbe.code='EXECUTION_API_OPERATION_DENIED';
  else runtimeProbe.projectId=['sahmt-17a16','sahmt-gestao-5ae66'].includes(operation.response?.result)?operation.response.result:null;}
 const receipt={code:'FA_CONSOLIDATION_APPS_SCRIPT_AUDIT',httpStatus:200,identityConfirmed:true,title:metadata.title,remoteFiles:content.files.length,
  sourceSha256:snapshotDigest(content),comparisons,runtimeProbe,deploymentTypes:(deployments.deployments||[]).flatMap(d=>(d.entryPoints||[]).map(e=>e.entryPointType)),remoteChanges:0};
 const stamp=Date.now();await writeFile(resolve(directory,'apps-script-source-'+stamp+'.dpapi.json'),JSON.stringify(protector.seal({metadata,content,deployments})),{flag:'wx',mode:0o600});
 await writeFile(resolve(directory,'apps-script-report-'+stamp+'.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt));
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_SCRIPT_AUDIT_FAILED',remoteChanges:0}));process.exitCode=1;}
